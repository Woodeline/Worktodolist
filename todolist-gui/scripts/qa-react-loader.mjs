// QA 专用 Node ESM loader：
// 1) 把裸说明符 'react' 重定向到极简 hooks 替身；
// 2) 为源码里省略扩展名的相对导入补上 .js（Node ESM 默认不允许，Vite 允许）。
export async function resolve(specifier, context, next) {
  if (specifier === 'react') {
    return { url: new URL('./qa-react-shim.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[a-zA-Z0-9]+$/.test(specifier)
  ) {
    try {
      return await next(`${specifier}.js`, context);
    } catch {
      // 落回默认解析
    }
  }
  return next(specifier, context);
}
