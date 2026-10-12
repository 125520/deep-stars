"use client";

import * as React from "react";

import { registerServiceWorker } from "@/lib/pwa";

/**
 * 注册 Service Worker
 *
 * 渲染成 null —— 它是一个副作用组件，存在的意义只是把这行调用
 * 放进客户端渲染流程。不需要 UI，不需要返回值。
 *
 * 放在根布局里而不是某个页面里：SW 的 scope 是 /，
 * 只在某一页注册会导致用户直接进别的页面时没有离线能力。
 */
export default function PwaRegister() {
  React.useEffect(() => {
    registerServiceWorker();
  }, []);

  return null;
}
