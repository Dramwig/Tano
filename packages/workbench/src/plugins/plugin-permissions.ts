import type { PluginPermission } from '@tano/protocol';
import { t } from '../i18n/i18n';

export const pluginPermissionLabels: Record<PluginPermission, string> = {
  get 'attachments.read'() {
    return t('只读访问工作区附件');
  },
  get 'attachments.write'() {
    return t('受限写入工作区附件');
  },
  get 'documents.read'() {
    return t('读取与打开文档');
  },
  get 'documents.write'() {
    return t('创建与修改文档');
  },
  get 'documents.move'() {
    return t('移动与重命名文档');
  },
  get 'documents.trash'() {
    return t('将文档移入回收站');
  },
  get 'objects.read'() {
    return t('读取对象');
  },
  get 'objects.write'() {
    return t('创建与修改对象');
  },
  get 'relations.read'() {
    return t('读取关系');
  },
  get 'relations.write'() {
    return t('修改关系');
  },
  get storage() {
    return t('保存插件本机状态');
  },
  get network() {
    return t('访问指定网络来源');
  },
  get connections() {
    return t('使用单独授权的服务凭据');
  },
  get native() {
    return t('调用指定本机能力');
  },
  get ui() {
    return t('运行隔离的自定义界面');
  },
  get 'ai.invoke'() {
    return t('调用同页助手模型推理（不接触密钥）');
  },
};

export function pluginPermissionLabel(permission: string): string {
  return (pluginPermissionLabels as Record<string, string>)[permission] ?? permission;
}
