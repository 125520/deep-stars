import { monthLabels, type HeatmapDay, type HeatmapGrid } from "@/lib/heatmap";
import { cn } from "@/lib/utils";

/**
 * 活动热力图
 * ══════════════════════════════════════════════════════════════════
 *
 * 服务端组件 —— 纯展示，没有任何交互状态，不需要 "use client"。
 *
 * 列 = 一周，行 = 周一..周日（与 lib/heatmap 的网格一致）。
 * 用 title 属性做悬停提示而不是自绘浮层：原生提示零代码、零层级问题，
 * 而且键盘聚焦与读屏都能拿到。
 */

/**
 * 0..4 级。
 *
 * 0 级与"未来"的格子都用**半透明白**而不是 surface-3 —— 后者是为页面底色配的，
 * 压在观测窗的星云上几乎看不见，整张网格会隐形（实测过：只能看到有记录的那一格）。
 * 半透明白会跟着背景明暗走，在星云上始终有对比。
 */
const LEVEL_CLASS = [
  "bg-white/10",
  "bg-violet-500/25",
  "bg-violet-500/45",
  "bg-violet-500/70",
  "bg-violet-500/95",
] as const;

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export default function ActivityHeatmap({
  grid,
  unit = "分钟",
}: {
  grid: HeatmapGrid;
  unit?: string;
}) {
  const total = grid.reduce(
    (sum, week) => sum + week.filter((d) => !d.future && d.value > 0).length,
    0,
  );

  return (
    <div className="flex flex-col gap-3">
      {/*
        窄屏上 26 周放不下。用横向滚动而不是压缩格子 ——
        格子小于 10px 就数不清了，热力图也就失去了意义。

        外面这层深色垫板是必需的：星云背景本身明暗不均，
        格子直接压上去会出现"某几列看得见、某几列看不见"。
      */}
      <div className="overflow-x-auto rounded-xl bg-void/55 p-4 pb-3">
        <div className="inline-flex flex-col gap-1.5">
          <MonthRow grid={grid} />

          <div className="flex gap-1.5">
            <div className="flex flex-col gap-[3px] pt-px">
              {WEEKDAYS.map((label, index) => (
                <span
                  key={label}
                  className="h-3 text-[9px] leading-3 text-ink-dim"
                  aria-hidden="true"
                >
                  {/* 只标周一三五，七行全标会挤成一团 */}
                  {index % 2 === 0 ? label : ""}
                </span>
              ))}
            </div>

            {/* 用 gap-[3px] 而不是 border 分隔：边框会在缩放时产生亚像素缝 */}
            <div className="flex gap-[3px]">
              {grid.map((week, columnIndex) => (
                <div key={columnIndex} className="flex flex-col gap-[3px]">
                  {week.map((day) => (
                    <Cell key={day.key} day={day} unit={unit} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        {/*
          给读屏一句总结：热力图对屏幕阅读器是一堆无意义的方块，
          而这里给出的信息量反而更大。
        */}
        <p className="text-[11.5px] text-ink-dim">
          <span className="sr-only">热力图：</span>
          共 {total} 天有记录
        </p>

        <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
          <span>少</span>
          {LEVEL_CLASS.map((className, index) => (
            <span key={index} className={cn("size-3 rounded-[3px]", className)} aria-hidden="true" />
          ))}
          <span>多</span>
        </div>
      </div>
    </div>
  );
}

function Cell({ day, unit }: { day: HeatmapDay; unit: string }) {
  const label = day.future
    ? `${day.key}（还没到）`
    : day.value > 0
      ? `${day.key} · ${Math.round(day.value)} ${unit}`
      : `${day.key} · 无记录`;

  return (
    <span
      title={label}
      aria-hidden="true"
      className={cn(
        "size-3 rounded-[3px] transition-transform duration-150 hover:scale-[1.35]",
        // 未来的日子不给填充，只留一圈淡描边 ——
        // 和"这天没学习"必须是两种观感，否则会把计划中的空白误读成懒惰
        day.future ? "border border-white/12" : LEVEL_CLASS[day.level],
      )}
    />
  );
}

/** 月份标签：推演在领域层（可测试），这里只负责摆位置 */
function MonthRow({ grid }: { grid: HeatmapGrid }) {
  const labels = monthLabels(grid);

  return (
    <div className="flex gap-[3px] pl-[15px]">
      {labels.map((label, index) => (
        <span
          key={index}
          className="w-3 text-[9px] leading-3 whitespace-nowrap text-ink-dim"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
