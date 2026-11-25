import { createHttpTodoRepository } from "./adapters/http-todo-repository.ts";
import { mountAsyncTodo } from "./mount-async-todo.tsx";

// 用 HTTP 仓库装配同一个异步应用。
mountAsyncTodo(createHttpTodoRepository());
