export type SkillType = 'script' | 'binary' | 'wasm' | 'container' | 'hybrid';

export interface SkillArtifacts {
  // 1. 独立二进制 (Executable) - 由 ProcessManager 管理
  binaries?: Record<string, string>; // platform -> path (e.g., 'darwin-arm64': './bin/scanner')

  // 2. 动态链接库 (Shared Library) - 由 Runtime FFI 加载
  libraries?: Record<string, string>;

  // 3. WebAssembly (Wasm)
  wasm?: string;

  // 4. OCI 容器编排
  container_stack?: string;
}

export interface SkillPermission {
  scope: 'device' | 'network' | 'kernel';
  request: string;
  criteria?: Record<string, any>;
  port?: number;
  description?: string;
}

export interface SkillInterfaces {
  ipc: 'unix-socket' | 'stdio';
  socket_path?: string;
}

export interface SkillManifestV2 {
  name: string;
  version: string;
  type: SkillType;
  description: string;
  artifacts?: SkillArtifacts;
  permissions?: SkillPermission[];
  interfaces?: SkillInterfaces;
}
