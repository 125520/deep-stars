import { redirect } from "next/navigation";

/**
 * 不带年份访问 /report 时跳到今年。
 *
 * 用 redirect 而不是在这一层渲染内容：年份是路径的一部分，
 * 有唯一地址才便于分享与收藏 —— 也让"切换年份"只是一个链接。
 */
export default function ReportIndexPage() {
  redirect(`/report/${new Date().getFullYear()}`);
}
