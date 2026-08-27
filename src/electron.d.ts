declare module 'electron' {
  export const shell: {
    openPath(targetPath: string): Promise<string>;
  };
}
