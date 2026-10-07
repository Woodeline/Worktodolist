// 工具集清单 —— 新增一个工具的唯一登记处。
//
// 加一个工具要动的地方：① 在 src/components/tools/ 下放一个自持状态的组件
// （不接收 props，自己管自己的数据）；② 在下面数组里加一条。
// 外壳只认这几个字段，所以 App.jsx、ToolsPage.jsx、样式表都不用改。
//
// 字段说明：
//   id      稳定标识，用于选中态与懒加载缓存，不要跟着标题改
//   name    工具名（左栏第一行）
//   desc    一句话说明（左栏第二行；窄屏会隐藏）
//   detail  工作区标题下方那段较长的解释
//   tags    分类标签，形态是"标签"不是按钮
//   icon    Icon.jsx 里的图标名
//   load    () => import(...)，工具多了以后不会一次全塞进首屏
export const TOOLS = [
  {
    id: 'rti',
    name: 'RTI 耐热指数',
    desc: '由老化试验数据推算 t₅₀ / RTI / 活化能',
    detail:
      '按 IEC 60216-1 终点时间法求各温度的 t₅₀，再做 Arrhenius 回归外推 RTI 与 95% 置信区间。数据与配置只存在本机浏览器里，不写 todo.txt。',
    tags: ['IEC 60216', 'Arrhenius', '回归'],
    icon: 'thermometer',
    load: () => import('./RtiTool.jsx'),
  },
];

export function findTool(id) {
  return TOOLS.find((t) => t.id === id) || null;
}
