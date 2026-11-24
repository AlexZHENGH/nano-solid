// 运行入口用来观察当前小节的终端输出。
import { createSignal } from "./reactive.ts";

const [count, setCount, subscribe] = createSignal(0);

subscribe(() => console.log(count()));
setCount(1);
setCount(2);
