type Entry = Uint8Array;

const files = new Map<string, Entry>();

function normalize(value: string): string {
    const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/");
    return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function bytes(value: string | Uint8Array): Uint8Array {
    return typeof value === "string" ? new TextEncoder().encode(value) : value.slice();
}

export async function access(filePath: string): Promise<void> {
    if (!files.has(normalize(filePath))) throw new Error(`ENOENT: ${filePath}`);
}

export async function mkdir(): Promise<void> {}

export async function writeFile(filePath: string, value: string | Uint8Array): Promise<void> {
    files.set(normalize(filePath), bytes(value));
}

export async function copyFile(source: string, destination: string): Promise<void> {
    const value = files.get(normalize(source));
    if (!value) throw new Error(`ENOENT: ${source}`);
    files.set(normalize(destination), value.slice());
}

export async function rm(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    const target = normalize(filePath);
    files.delete(target);
    if (options?.recursive) {
        for (const name of [...files.keys()]) {
            if (name.startsWith(`${target}/`)) files.delete(name);
        }
    }
}

export async function rename(source: string, destination: string): Promise<void> {
    const from = normalize(source);
    const to = normalize(destination);
    const direct = files.get(from);
    if (direct) {
        files.set(to, direct);
        files.delete(from);
        return;
    }
    for (const name of [...files.keys()]) {
        if (!name.startsWith(`${from}/`)) continue;
        const value = files.get(name)!;
        files.set(`${to}${name.slice(from.length)}`, value);
        files.delete(name);
    }
}

export function resetVirtualFiles(): void {
    files.clear();
}

export function getVirtualFiles(root: string): Map<string, Uint8Array> {
    const prefix = `${normalize(root)}/`;
    return new Map(
        [...files.entries()]
            .filter(([name]) => name.startsWith(prefix))
            .map(([name, value]) => [name.slice(prefix.length), value]),
    );
}
