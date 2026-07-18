/** madge ships no type declarations — minimal surface the harness uses. */
declare module "madge" {
  interface MadgeInstance {
    obj(): Record<string, string[]>;
  }
  interface MadgeConfig {
    baseDir?: string;
    fileExtensions?: string[];
    includeNpm?: boolean;
    excludeRegExp?: RegExp[];
    tsConfig?: string;
  }
  export default function madge(path: string | string[], config?: MadgeConfig): Promise<MadgeInstance>;
}
