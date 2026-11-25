import { createMemoryAsyncTodoRepository } from "./adapters/memory-async-todo-repository.ts";
import { mountAsyncTodo } from "./mount-async-todo.tsx";
import { INITIAL_TODOS } from "./types.ts";

// 同一页中的多个挂载周期共用同一个内存仓库。
mountAsyncTodo(createMemoryAsyncTodoRepository(INITIAL_TODOS));
