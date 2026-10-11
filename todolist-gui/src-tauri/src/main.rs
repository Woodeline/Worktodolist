// 发布版不弹控制台窗口：`--reminder` 由计划任务静默调用，弹黑窗会非常突兀。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    worktodolist_lib::run()
}
