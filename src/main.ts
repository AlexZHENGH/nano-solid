// 运行入口用来观察当前小节的终端输出。
import { createEffect, createSignal } from "./reactive.ts";

const [count, setCount] = createSignal(0);

try {
  createEffect(() => {
    const current = count();
    console.log("effect run:", current);
    throw new Error("boom");
  });
} catch (error) {
  console.log("caught:", (error as Error).message);
}

try {
  setCount(1);
  console.log("setCount(1) ok");
} catch (error) {
  console.log("setCount(1) failed:", (error as Error).message);
}
