import { isShortId, workspaceSettingsPath } from '@tano/protocol';
import type { FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';
import { builtinWorkspaceIcon } from './workspace-icons';
import { parsePageTitleSource } from './page-title-source';
import type { PageTitleSource } from './page-title-source';
import { folderHomeFileNames, type FolderHomeFileName } from './folder-home';

export interface WorkspaceSettings {
  version: 1;
  name: string;
  icon: string;
  homePageId: string;
  pageTitleSource: PageTitleSource;
  folderHomeFileName: FolderHomeFileName;
  showPlan: boolean;
  showGraph: boolean;
  showPlugins: boolean;
  showCollaborationViews: boolean;
  showPeopleDirectory: boolean;
}
export const defaultWorkspaceSettings: WorkspaceSettings = {
  version: 1, name: '', icon: '', homePageId: '', pageTitleSource: 'frontmatter-first', folderHomeFileName: 'README.md', showPlan: true,
  showGraph: true, showPlugins: true, showCollaborationViews: true, showPeopleDirectory: true,
};
export type WorkspaceSettingKey = Exclude<keyof WorkspaceSettings, 'version'>;
export type WorkspaceSettingsPatch = {
  [K in WorkspaceSettingKey]: { key: K; value: WorkspaceSettings[K]; previous: WorkspaceSettings[K] }
}[WorkspaceSettingKey];

export function parseWorkspaceSettings(content: string): WorkspaceSettings {
  const raw = JSON.parse(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1)
    throw new Error('工作区设置格式无效');
  const settings = { ...defaultWorkspaceSettings };
  for (const key of Object.keys(settings) as (keyof WorkspaceSettings)[]) {
    if (key === 'version' || raw[key] === undefined) continue;
    if (typeof raw[key] !== typeof settings[key]) throw new Error(`工作区设置 ${key} 类型无效`);
    Object.assign(settings, { [key]: raw[key] });
  }
  if (settings.name !== settings.name.trim() || [...settings.name].length > 65 || /[\r\n\x00-\x1f]/.test(settings.name))
    throw new Error('工作区名称最多 65 个字符，不能包含换行或控制字符');
  if (settings.homePageId && !isShortId(settings.homePageId)) throw new Error('默认页面 ID 无效');
  if (settings.folderHomeFileName !== '' && !folderHomeFileNames.includes(settings.folderHomeFileName))
    throw new Error('文件夹首页文件名无效');
  if (parsePageTitleSource(settings.pageTitleSource) !== settings.pageTitleSource)
    throw new Error('页面标题来源无效');
  if (settings.icon.startsWith('data:')) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(settings.icon) || settings.icon.length > 200_000)
      throw new Error('工作区图标图片无效或过大');
  } else if (settings.icon.startsWith('icon:')) {
    if (!builtinWorkspaceIcon(settings.icon)) throw new Error('未知的内置工作区图标');
  } else if ([...settings.icon].length > 16 || /[\r\n\x00-\x1f]/.test(settings.icon)) {
    throw new Error('请使用一个表情符号作为工作区图标');
  }
  return settings;
}

export async function loadWorkspaceSettings(adapter: WorkspaceAdapter, workspace: Workspace) {
  if (!workspace.files.some(file => file.kind === 'file' && file.path === workspaceSettingsPath))
    return { snapshot: null, settings: { ...defaultWorkspaceSettings } };
  const snapshot = await adapter.read(workspaceSettingsPath);
  return { snapshot, settings: parseWorkspaceSettings(snapshot.content) };
}

/** Compare against the value the user saw; merge edits to other fields with a fresh hash. */
export async function saveWorkspaceSettingsPatch(adapter: WorkspaceAdapter, base: FileSnapshot | null, patch: WorkspaceSettingsPatch): Promise<{
  snapshot: FileSnapshot; settings: WorkspaceSettings; workspace?: Workspace;
}> {
  if (!Object.hasOwn(defaultWorkspaceSettings, patch.key) || patch.key === ('version' as string)) throw new Error('未知工作区设置');
  const desired = parseWorkspaceSettings(JSON.stringify({ ...defaultWorkspaceSettings, [patch.key]: patch.value }))[patch.key];
  let current = base;
  for (let attempt = 0; attempt < 3; attempt++) {
    const settings = current ? parseWorkspaceSettings(current.content) : { ...defaultWorkspaceSettings };
    if (settings[patch.key] !== patch.previous && settings[patch.key] !== desired)
      throw new Error('此项工作区设置已被其他人或程序修改；你的修改尚未保存，请检查最新值后重试。');
    const content = JSON.stringify({ ...(current ? JSON.parse(current.content) : {}), ...settings, [patch.key]: desired }, null, 2) + '\n';
    if (current) {
      const result = await adapter.write(workspaceSettingsPath, content, current.hash);
      if (result.status === 'saved') return { snapshot: result.snapshot, settings: parseWorkspaceSettings(content) };
      if (result.status === 'missing') throw new Error('工作区设置已被移除，请刷新后重试');
      current = result.snapshot;
    } else {
      let workspace: void | Workspace;
      try { workspace = await adapter.create(workspaceSettingsPath, content); }
      catch (error) {
        try { current = await adapter.read(workspaceSettingsPath); } catch { throw error; }
        continue;
      }
      const snapshot = await adapter.read(workspaceSettingsPath);
      return { snapshot, settings: parseWorkspaceSettings(snapshot.content), ...(workspace ? { workspace } : {}) };
    }
  }
  throw new Error('工作区设置正在被其他程序修改，请稍后重试');
}
