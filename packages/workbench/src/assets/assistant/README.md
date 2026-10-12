# 同页助手蝴蝶组件

[AssistantButterfly.vue](../../components/AssistantButterfly.vue) 是同页文档右下角助手入口和助手面板欢迎区共用的极简蝴蝶组件。图形与动画集中在该组件中，不再维护独立的 SVG 图片副本。

```vue
<!-- 入口已有按钮名称，蝴蝶默认为装饰图形 -->
<AssistantButterfly :size="36" />
<!-- 独立展示时提供无障碍名称；motion="none" 可关闭全部动画 -->
<AssistantButterfly :size="30" motion="none" label="同页助手" />
```

- `size`：数字或字符串，默认 `36`；调用处可用 CSS 适配窄屏尺寸。
- `motion`：`breathe`（默认呼吸）、`fly`（飞行振翅）、`perch`（收翅停靠）或 `none`（静止），统一控制整体和双翼动画。
- `label`：可选无障碍名称；未提供时图形对辅助技术隐藏。
- `wingPose`：可选的 `{ left, right }` 翅膀展开比例；仅在 `motion="fly"` 时接管振翅，供飞行层连续控制起飞和落停姿态。普通展示无需传入。
- `flutter()`：组件实例公开的单次扑腾动作；仅在呼吸状态可调用，进行中忽略重复调用。鼠标移入右下角圆球时触发，680ms 内快速收翅、展开、轻轻回稳；持续悬停不重复，移出后再次移入可重新触发。右下角圆球的触摸悬停不触发；助手欢迎区的圆形按钮支持点击、触摸轻点和键盘激活，每次动作结束后可再次触发。减少动态效果模式下不触发。
- 欢迎区蝴蝶按钮预留为同页平台 AI 设置入口，目前点击仅扑翅，提示“同页 AI 设置（即将推出）”；后续接入平台 AI 设置面板。
- 后续姿态动画在组件内部扩展 `motion` 状态，左右翅膀有独立 SVG 分组，可分别控制。页面移动和目标定位由外层协调。

- 仅用舒展的上翅和轻巧的下翅组成略有不对称的蝴蝶；不画触角、躯干或人物表情，中心留白。
- 使用原创 SVG 路径；32 × 32 viewBox，1.5px 圆角线条，单色、透明背景。视口按翅膀的视觉重心校正，保证图形在圆内居中。
- 桌面在 54px 圆形按钮内显示为 36px；窄窗口在 50px 按钮内显示为 32px。鼠标悬浮时按钮在原位放大 6%，过渡为 200ms。
- 圆形按钮的背景、边框、轻微阴影和悬浮交互由 `AssistantLauncher.vue` 控制；蝴蝶组件通过 `--text` 主题色自动适配深浅色。
- 呼吸周期为 8 秒：两翼横向缩放为 0.94–1，转角为 ±1°；整体缩放为 0.985–1.015，让 32–36px 的图标仍能看出轻微开合。保持固定倾角，不上下漂移；圆形按钮保持稳定。呼吸只使用 CSS transform，不使用 JavaScript 计时器或逐帧布局测量。系统开启减少动态效果时，两种动画都会关闭。
- 悬停扑腾使用双翼内层 SVG 分组叠加 CSS transform，外层呼吸持续运行、不重置节奏；通过动画结束或取消事件清理单次动作，不增加定时器或逐帧回调，也不修改飞行姿态。
- 此素材属于仓库的 MIT 许可范围。无需图片生成或外部图标资源。

## 使用飞行与停靠

飞行目前作为隐藏彩蛋：在正文编辑视图中选中文字，连续 30 秒没有操作后，蝴蝶自动飞过去停靠。鼠标移动、按键、滚动、输入或更改选区会重新计时；拖选、按住按键和输入法组词期间不会触发。同一次选区仅触发一次，选区取消、切换文档、进入源码模式、打开助手、窗口失焦或隐藏都会停止等待；恢复条件后重新等待完整的 30 秒。助手忙碌和已有飞行动作期间也不触发。

页面不展示彩蛋菜单或提示。普通点击圆球仍打开助手；蝴蝶飞出后，点击原位圆球或按 `Esc` 可返回。通用组件停靠接口与面包屑、文档操作按钮的注册保留，供后续动画调用。选区计时由 [butterfly-idle.ts](../../assistant/butterfly-idle.ts) 管理，仅在实际触发时创建临时文字锚点，不移动焦点或更改选区。

空闲检测与帮助提示共用 [user-activity.ts](../../user-activity.ts)：每个窗口只有一组活动监听和一个截止时间定时器。鼠标移动与滚动只更新最后操作时间，不读取选区、不测量布局、不重建定时器；蝴蝶仅在选区或上下文变化时检查资格，并在 30 秒空闲真正到期时复核选区。没有合格选区时不安排彩蛋任务，窗口隐藏、失焦、拖选或输入法组词期间暂停共享定时器，最后一个订阅者卸载时释放监听。帮助提示仍有独立的冷却、展示频率和关闭设置。

1. **本体**：[AssistantButterfly.vue](../../components/AssistantButterfly.vue) 负责图形与姿态，不依赖编辑器和页面坐标。
2. **飞行层**：[AssistantButterflyLayer.vue](../../components/AssistantButterflyLayer.vue) 通过 `Teleport` 挂载到 `body`，使用视口坐标移动，脱离按钮和文档滚动容器的裁剪。外层平移、转向，内层振翅；整个浮层允许鼠标穿透并位于对话框下方。每个工作台窗口由 App 提供一个控制器和飞行实例。
3. **控制器**：[butterfly.ts](../../assistant/butterfly.ts) 管理注册、目标测量、弧线飞行、悬停、落下、跟随和返回。仅飞出后运行位置追踪；停靠测量最多约 30 次/秒，以跟随滚动、缩放及 CSS 变换，返回后停止。隐藏窗口、切换文档/面板、打开助手或卸载时取消并释放临时资源。
4. **文字位置**：编辑器的 `captureVisualAnchor()` 返回 `{ element, getRects(), dispose() }`。范围通过 ProseMirror 事务映射跟随独立编辑，目标删除时失效；读取坐标时临时构造 DOM Range，跨行选择使用首个可见文字矩形。位置元数据不进入 Markdown 或撤销历史。源码模式目前不提供文字停靠。

飞行轨迹由 [butterfly-flight.ts](../../assistant/butterfly-flight.ts) 独立规划：连续的贝塞尔曲线组成起飞、舒展的转弯、反向弯和接近目标的弧线；最后一段切线朝向停靠姿态。路径按弧长采样，并根据曲率提前减速，避免短弯和长直线使用同一速度。默认航程按实际路线和转弯程度取 1.8–5.6 秒，返回采用相同速度规则。到达后短暂停留，再用 680ms 轻落。

振翅与移动共享节奏：两次短暂滑翔时舒展翅膀，其余时间采用较快收翅、较慢展开的拍翅，连续时钟不会在阶段切换时重置。身体侧倾、俯仰和左右翅的细微差异随转弯和振翅变化；这些姿态由飞行层独立控制，不改变沿轨迹的朝向。起飞时逐渐增加幅度，落停时逐渐收翅、恢复平稳姿态。默认呼吸动画保持 8 秒不变。

飞行朝向由每帧实际位移向量计算，并抵消 SVG 本身的 −6° 静态倾角，使身体前方朝着移动方向。转身沿最短角度平滑追随，跨越 ±180° 时不会绕一整圈；近乎静止时保持朝向。接近目标时沿弧线转向 `placement.angle`，悬停和落停只做最后的姿态收束，微小悬停漂移不会触发原地旋转。路线在目标或视口变化时重新计算，平常复用弧长表。

目标离屏、被遮挡、隐藏或卸载时返回圆球；默认圆球也不可用时直接结束飞行。系统开启减少动态效果时直接切换位置，关闭振翅、落下与呼吸。主体范围、菜单和其他组件的原有点击行为保持可用。

### 通用组件停靠点

通过 [butterfly-vue.ts](../../assistant/butterfly-vue.ts) 的指令将任意原生元素注册为停靠点。指令随元素挂载、更新、卸载维护注册，无需全局 CSS 选择器。以下示例可放在工作台组件中：

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { butterflyPerchDirective, useButterflyController } from '../assistant/butterfly-vue';
import type { ButterflyPerch } from '../assistant/butterfly-vue';

const props = defineProps<{ scope: string }>();
const butterfly = useButterflyController();
const vButterflyPerch = butterflyPerchDirective(butterfly);
const perch = computed<ButterflyPerch>(() => ({
  id: `save:${props.scope}`,
  scope: props.scope,
  label: '保存按钮',
  placement: { edge: 'top', align: .75, gap: -4, angle: 0 },
}));
</script>
<template><button v-butterfly-perch="perch">保存</button></template>
```

`scope` 由 `butterflyScope(workspaceId, paneId, fileId)` 生成，将窗口内的工作区、面板和文档隔离。每个目标的 `id` 在控制器内唯一；面包屑和文档操作按钮已接入，标签页、卡片和评论等可使用同一个指令接入。

| 目标 | 建议落点 | 表现 |
| --- | --- | --- |
| 面包屑 | 当前文档名称的上沿或分隔符旁 | 像停在细枝上，轻轻收翅 |
| 按钮 | 顶边或角落 | 贴着边缘落下，保持按钮文字与点击区域可用 |
| 标签页 | 标签顶部边缘 | 随标签移动，切换时根据目标是否仍可见决定继续停靠或返回 |
| 卡片、评论、提示框 | 顶边或标题旁 | 靠近相关内容，作为定位或提示的视觉引导 |
| 文档文字 | 指定文字所在行的上沿 | 跟随文字的实际排版位置 |

`placement.edge` 支持 `top`、`bottom`、`left`、`right`、`center`；`align` 为沿边缘的 0–1 相对位置，`gap` 为间距，`angle` 为朝向。顶边空间不足时自动改到下方，并将落点限制在视口内。

### 控制接口

`useButterflyController()` 获取当前工作台控制器；无宿主时返回 `undefined`，展示组件仍可单独使用。独立宿主可用 `createButterflyController()` 创建控制器，自行设置上下文并在结束时 `dispose()`。

| 接口 | 行为 |
| --- | --- |
| `registerTarget(target)` | 注册目标，返回 `update(target)` 和 `dispose()`；同名旧注册的清理不会误删新注册 |
| `flyTo(id, { duration?, hoverMs? })` | 飞向当前上下文中的目标；Promise 返回 `arrived`、`cancelled` 或 `unavailable` |
| `returnHome()` | 返回当前圆球；也返回上述 Promise 结果 |
| `cancel()` | 立即停止，恢复圆球里的蝴蝶，释放临时目标 |
| `setContext(scope, enabled)` | 更新所属文档/面板及可用状态；上下文变化会取消旧动作 |
| `setReducedMotion(boolean)` | 直接切换静止位置，可在飞行过程中生效 |
| `listTargets(scope?)` | 列出普通停靠目标，供菜单等入口展示 |
| `state` | 只读的阶段、位置、尺寸、目标和可用状态 |
| `dispose()` | 取消动画并清理全部注册与临时资源 |

手动注册的 `ButterflyTarget` 必须提供 `id`、`scope`、`label`、`element()`，可增加 `rects()`（多个精确文字矩形）、`available()`、`placement`、`kind` 和 `onDispose()`。短期文字目标设置 `temporary: true`，控制器会在离开、失败或取消时释放。调用 `flyTo` 只改变展示状态，不会点击目标。

阶段依次为 `docked → flying → hovering → landing → perched → returning → docked`。新的飞行命令替换旧命令，旧 Promise 返回 `cancelled`，避免过期动画完成后改写当前状态。

坐标、飞行阶段和临时停靠目标均属于运行时展示状态；不写入用户 Markdown，也不改变文档内容或文件身份。
