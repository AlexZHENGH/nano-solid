// 运行入口用来观察当前小节的终端输出。
import { createSignal } from "./reactive.ts";

const [count, setCount] = createSignal(0);

console.log(count());
setCount(1);
console.log(count());
setCount(2);
console.log(count());
