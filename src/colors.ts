export const CUSHION_COLOR_PALETTE = [
    { name: "black", red: 0x1d, green: 0x1d, blue: 0x21 },
    { name: "white", red: 0xf9, green: 0xff, blue: 0xfe },
    { name: "orange", red: 0xf9, green: 0x80, blue: 0x1d },
    { name: "magenta", red: 0xc7, green: 0x4e, blue: 0xbd },
    { name: "light_blue", red: 0x3a, green: 0xb3, blue: 0xda },
    { name: "yellow", red: 0xfe, green: 0xd8, blue: 0x3d },
    { name: "lime", red: 0x80, green: 0xc7, blue: 0x1f },
    { name: "pink", red: 0xf3, green: 0x8b, blue: 0xaa },
    { name: "gray", red: 0x47, green: 0x4f, blue: 0x52 },
    { name: "light_gray", red: 0x9d, green: 0x9d, blue: 0x97 },
    { name: "cyan", red: 0x16, green: 0x9c, blue: 0x9c },
    { name: "purple", red: 0x89, green: 0x32, blue: 0xb8 },
    { name: "blue", red: 0x3c, green: 0x44, blue: 0xaa },
    { name: "brown", red: 0x83, green: 0x54, blue: 0x32 },
    { name: "green", red: 0x5e, green: 0x7c, blue: 0x16 },
    { name: "red", red: 0xb0, green: 0x2e, blue: 0x26 },
] as const;

export type CushionColorName = typeof CUSHION_COLOR_PALETTE[number]["name"];
