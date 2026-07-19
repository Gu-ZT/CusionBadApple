import { computed, ref } from "vue";

export type Locale = "zh-CN" | "en-US";

const messages = {
    "zh-CN": {
        subtitle: "浏览器内视频转 Minecraft 坐垫数据包",
        settings: "生成设置", video: "视频", output: "输出", mode: "转换模式",
        resolution: "屏幕尺寸", width: "宽度", height: "高度", clip: "视频片段",
        start: "开始秒数", end: "结束秒数", invert: "反转颜色",
        clipHint: "仅生成指定的开始和结束时间。", fullVideoHint: "关闭后从视频开头生成到结尾。",
        macroStorage: "Storage 宏", macroStorageHint: "把每帧变化状态写入 storage，并通过函数宏应用。",
        uuidEntities: "固定 UUID", uuidEntitiesHint: "为坐垫分配固定 UUID，直接定位变化坐垫。",
        upload: "选择视频", drop: "点击或拖入视频文件", local: "视频和数据包始终在本机浏览器内处理。",
        generate: "生成数据包", download: "下载 ZIP", processing: "正在处理", idle: "等待视频",
        wasm: "加载 FFmpeg WASM", decode: "解码为 20 FPS", generateStage: "生成帧函数",
        zip: "压缩数据包", done: "生成完成", failed: "生成失败", selected: "已选择",
        memory: "浏览器内存提示", memoryText: "完整视频可能需要数 GiB 内存。建议先生成 5 秒片段验证效果。",
        language: "语言", theme: "主题", light: "浅色", dark: "深色", clearEnd: "留空表示视频结束",
        modeNearest: "校色最近色", modeDither: "Floyd-Steinberg", modeOrdered: "CIEDE2000 有序抖动",
        modeBinary: "黑白二值", modeGrayDither: "黑白 Floyd-Steinberg", modeGrayOrdered: "黑白 4×4 有序抖动",
        modeRgbwNearest: "RGBW 最近色", modeRgbwDither: "RGBW 误差扩散",
        threshold: "黑白阈值", invalidClip: "结束时间必须大于开始时间。", noFile: "请先选择视频文件。",
        sizeLimit: "宽高乘积不能超过 32768。", completed: "ZIP 已准备好，可以下载。",
        preloadTitle: "正在准备视频引擎", preloadHint: "首次加载需要下载约 32 MB，完成后即可开始转换。",
        preloadFailed: "FFmpeg 加载失败，请检查网络后重试。", retry: "重试",
    },
    "en-US": {
        subtitle: "Video to Minecraft cushion datapack, entirely in your browser",
        settings: "Generation settings", video: "Video", output: "Output", mode: "Conversion mode",
        resolution: "Screen size", width: "Width", height: "Height", clip: "Video clip",
        start: "Start second", end: "End second", invert: "Invert colors",
        clipHint: "Generate only the selected start and end range.", fullVideoHint: "Disabled: generate from the beginning to the end.",
        macroStorage: "Storage macros", macroStorageHint: "Store changed frame states and apply them through function macros.",
        uuidEntities: "Fixed UUIDs", uuidEntitiesHint: "Assign deterministic UUIDs and address changed cushions directly.",
        upload: "Choose video", drop: "Click or drop a video file", local: "Videos and datapacks stay inside your browser.",
        generate: "Generate datapack", download: "Download ZIP", processing: "Processing", idle: "Waiting for video",
        wasm: "Loading FFmpeg WASM", decode: "Decoding at 20 FPS", generateStage: "Writing frame functions",
        zip: "Compressing datapack", done: "Generation complete", failed: "Generation failed", selected: "Selected",
        memory: "Browser memory", memoryText: "A full video can require several GiB of memory. Generate a 5-second clip first.",
        language: "Language", theme: "Theme", light: "Light", dark: "Dark", clearEnd: "Leave empty for the full video",
        modeNearest: "Calibrated nearest", modeDither: "Floyd-Steinberg", modeOrdered: "CIEDE2000 ordered dither",
        modeBinary: "Binary B/W", modeGrayDither: "B/W Floyd-Steinberg", modeGrayOrdered: "B/W 4×4 ordered dither",
        modeRgbwNearest: "RGBW nearest", modeRgbwDither: "RGBW error diffusion",
        threshold: "B/W threshold", invalidClip: "End time must be greater than start time.", noFile: "Choose a video first.",
        sizeLimit: "Width multiplied by height cannot exceed 32768.", completed: "The ZIP is ready to download.",
        preloadTitle: "Preparing the video engine", preloadHint: "The first load downloads about 32 MB. Conversion will be available when it finishes.",
        preloadFailed: "FFmpeg failed to load. Check your connection and try again.", retry: "Retry",
    },
} as const;

export const locale = ref<Locale>((localStorage.getItem("locale") as Locale) || "zh-CN");
export const t = computed(() => messages[locale.value]);

export function setLocale(value: Locale): void {
    locale.value = value;
    localStorage.setItem("locale", value);
    document.documentElement.lang = value;
}
