export interface PythonResult {
    stdout: string;
    stderr: string;
    code: number;
}
export declare function resolvePythonBin(env?: NodeJS.ProcessEnv): string;
export declare function runPythonScript(scriptPath: string, args: string[], opts?: {
    cwd?: string;
    stdin?: string;
    pythonBin?: string;
    timeoutMs?: number;
}): Promise<PythonResult>;
export declare function runPythonJson<T>(scriptPath: string, args: string[], opts?: {
    cwd?: string;
    stdin?: string;
    pythonBin?: string;
    timeoutMs?: number;
}): Promise<T>;
//# sourceMappingURL=runner.d.ts.map