// 数据表格里的数字输入格 —— 三个页面共用。
//
// 这里刻意**不是** `type="number"`：
//   受控的 number 输入在用户打到 "76." 或 "-" 这种中间态时，浏览器报上来的 value
//   是空串（按 HTML 规范 "76." 不是合法数字），React 一回写就把用户刚敲的小数点
//   吞掉了。数据表里全是 76.4、1512 这类值，小数点必须能正常输入。
//   所以改用 text + inputMode="decimal"：桌面端就是个普通文本框（也没有
//   我们不想要的上下箭头），触屏上仍会唤出数字键盘。解析统一交给 lib/rti/calc.js。
export default function NumberCell({ value, onChange, placeholder, title }) {
  return (
    <input
      className="tool-input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={value ?? ''}
      placeholder={placeholder}
      title={title}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
