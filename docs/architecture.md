# Kairo 内核架构设计

本文档在 [README.md](/Users/hjr/Desktop/Kairo/README.md) 的总体设计基础上，进一步细化 Kairo 的内核模块划分、关键抽象、核心数据流和 Linux 用户态兼容层落点。本文档面向后续代码演进，目标是为 `kairo-kernel` 的模块拆分和实现顺序提供直接指导。

## 1. 文档目标

本文档主要回答四个问题：

1. Kairo 内核应该拆成哪些模块。
2. 这些模块之间如何协作。
3. Linux 兼容能力应落在哪些层次。
4. 当前原型代码应如何平滑演进到完整骨架。

本文档不追求一次性定义所有实现细节，而是优先明确架构边界，避免后续开发过程中职责混乱。

## 2. 架构原则

Kairo 的内核架构建议遵循以下原则：

- 核心路径尽量短，保证启动、异常、调度和 syscall 路径可控。
- 抽象分层清晰，避免把 Linux 兼容逻辑直接散落进所有子系统。
- 能力按“最小闭环”逐步引入，不做超前设计。
- 对外行为尽量稳定，对内实现允许逐步替换。

从工程角度看，Kairo 更适合采用“分层宏内核”结构，而不是纯微内核。

## 3. 分层模型

建议将 Kairo 划分为五层：

```text
+------------------------------------------------------+
| 用户程序与运行时                                       |
+------------------------------------------------------+
| Linux ABI 兼容层                                       |
+------------------------------------------------------+
| 内核服务层                                             |
+------------------------------------------------------+
| 内核基础设施层                                         |
+------------------------------------------------------+
| 架构与硬件抽象层                                       |
+------------------------------------------------------+
```

各层职责如下。

### 3.1 架构与硬件抽象层

负责与 CPU、平台和启动环境直接交互，提供：

- 启动入口
- 中断与异常入口
- 页表切换
- 上下文切换
- 定时器与中断控制器
- CPU 本地状态

这一层应尽量薄，主要作用是屏蔽架构差异。

### 3.2 内核基础设施层

为更高层模块提供通用基础能力，包括：

- 物理内存分配
- 虚拟内存映射
- 锁与同步原语
- 内核对象标识
- 日志与诊断
- 错误码与结果类型

这一层不应依赖进程、文件系统等高层语义。

### 3.3 内核服务层

这是系统最核心的一层，主要包含：

- 进程与线程管理
- 调度器
- VFS
- 文件描述符表
- IPC
- 网络栈
- 驱动管理

这一层提供内核的真实功能实现。

### 3.4 Linux ABI 兼容层

这是 Kairo 与普通 Rust 教学内核最大的区别。该层负责把“用户态的 Linux 预期”翻译成“内核内部的 Kairo 实现”，主要包括：

- syscall 分发
- Linux errno 语义
- `clone/futex/signal` 兼容
- `/proc` 与 `/dev` 的行为映射
- ELF 装载参数布局
- 进程启动时的用户栈构造

这一层不一定是单独进程，也不一定是单独 crate，但在架构上必须明确存在。

### 3.5 用户程序与运行时

该层不完全属于内核，但与内核 ABI 紧密耦合，包括：

- `init`
- shell
- 动态链接器
- libc
- 基础工具程序

内核架构设计必须为这层留下明确接口。

## 4. 推荐模块划分

建议把 [`kairo-kernel`](/Users/hjr/Desktop/Kairo/kairo-kernel) 逐步拆分为如下模块。

```text
kairo-kernel/src/
├── arch/
├── boot/
├── console/
├── diag/
├── memory/
├── task/
├── syscall/
├── abi/
├── fs/
├── ipc/
├── net/
├── driver/
├── user/
└── main.rs
```

下面逐一说明模块职责。

## 5. 架构与启动模块

### 5.1 `arch/`

`arch/` 用于承载与架构强相关的实现，建议再细分：

```text
arch/
└── x86_64/
    ├── cpu.rs
    ├── gdt.rs
    ├── idt.rs
    ├── interrupt.rs
    ├── paging.rs
    ├── timer.rs
    └── context.rs
```

职责包括：

- 中断描述符表初始化
- 异常处理入口
- 上下文保存与恢复
- 用户态切换
- `syscall/sysret` 或中断门入口支持
- CPU 本地变量

原则上，`arch/` 只暴露少量稳定接口给上层，例如：

- `arch::init_early()`
- `arch::init_late()`
- `arch::enable_interrupts()`
- `arch::halt()`
- `arch::switch_to_user(...)`

### 5.2 `boot/`

`boot/` 负责承接 bootloader 提供的信息，并整理成内核可消费的统一启动上下文。

建议定义：

```rust
pub struct BootContext {
    pub memory_map: MemoryMapView,
    pub framebuffer: Option<FramebufferInfo>,
    pub rsdp: Option<u64>,
    pub kernel_phys_range: PhysRange,
}
```

这样后续内核其他模块不需要直接依赖 `bootloader_api::BootInfo`。

## 6. 控制台与诊断模块

### 6.1 `console/`

当前仓库中的 [`kairo-kernel/src/serial.rs`](/Users/hjr/Desktop/Kairo/kairo-kernel/src/serial.rs) 和 [`kairo-kernel/src/vga_buffer.rs`](/Users/hjr/Desktop/Kairo/kairo-kernel/src/vga_buffer.rs) 可以逐步演化进 `console/`。

建议提供统一控制台抽象：

```rust
pub trait Console {
    fn write_bytes(&self, bytes: &[u8]);
}
```

再由串口、framebuffer 文本层等实现该 trait。

建议早期控制台分三类：

- 串口控制台：最可靠，优先用于调试
- framebuffer 调试输出：用于肉眼观察
- panic 紧急输出：尽量避免依赖锁

### 6.2 `diag/`

`diag/` 用于放置：

- 内核日志级别
- panic 打印
- 调试断言
- 启动阶段诊断信息
- 内核错误码格式化

这能避免把调试逻辑散落进业务模块。

## 7. 内存管理模块

### 7.1 `memory/` 的目标

`memory/` 是 Phase 1 到 Phase 3 的核心支撑模块，建议拆成：

```text
memory/
├── addr.rs
├── frame.rs
├── heap.rs
├── mapper.rs
├── page_fault.rs
└── user_vm.rs
```

### 7.2 核心抽象

建议定义以下对象：

```rust
pub struct PhysFrame;
pub struct VirtPage;
pub struct AddressSpace;
pub struct VmArea;
```

其中：

- `AddressSpace` 表示一个进程的完整虚拟地址空间。
- `VmArea` 表示一段连续映射区域，后续可对应 Linux 中 `mmap` 的逻辑区间。

### 7.3 内存管理职责边界

`memory/` 负责：

- 内核堆初始化
- 页分配与回收
- 用户空间页映射
- 缺页异常处理入口
- `mmap/brk/mprotect` 基础实现

`memory/` 不应负责：

- ELF 解析
- 文件系统页缓存策略
- 线程调度

这些逻辑应分别由 `user/`、`fs/`、`task/` 负责，再调用内存层接口。

## 8. 任务与调度模块

### 8.1 `task/`

该模块负责进程、线程和调度器。建议拆分：

```text
task/
├── process.rs
├── thread.rs
├── scheduler.rs
├── context.rs
├── pid.rs
├── signal.rs
└── futex.rs
```

### 8.2 核心对象

建议最少定义三类对象：

```rust
pub struct Process;
pub struct Thread;
pub struct ThreadGroup;
```

职责区分建议如下：

- `Process`：地址空间、文件描述符表、挂载视图、凭据
- `Thread`：执行上下文、内核栈、状态、信号屏蔽字
- `ThreadGroup`：Linux 兼容所需的线程组概念

### 8.3 调度器建议

早期建议采用简单的可运行队列模型：

- 单队列或每 CPU 队列
- 抢占式时钟驱动
- 显式阻塞与唤醒

后续再逐步演进为：

- 多核负载均衡
- 优先级
- 实时任务支持

### 8.4 Linux 兼容关键点

`task/` 从一开始就要考虑以下兼容预留：

- `fork`
- `execve`
- `clone`
- `wait4`
- 线程组退出
- 僵尸进程回收
- 信号投递

如果这些抽象在早期没有分清，后续很容易在 `clone` 和 `signal` 上大面积返工。

## 9. 系统调用与 ABI 兼容模块

### 9.1 `syscall/`

`syscall/` 负责 syscall 入口、参数解析和分发。建议结构如下：

```text
syscall/
├── mod.rs
├── table.rs
├── dispatcher.rs
├── fs.rs
├── task.rs
├── memory.rs
├── time.rs
├── net.rs
└── error.rs
```

推荐设计为：

- `arch/` 负责把寄存器参数取出来
- `syscall/dispatcher.rs` 负责编号分发
- 各子模块负责具体语义实现

### 9.2 `abi/`

`abi/` 模块应专门存放 Linux 兼容定义，例如：

```text
abi/
└── linux/
    ├── errno.rs
    ├── syscall.rs
    ├── signal.rs
    ├── stat.rs
    ├── auxv.rs
    └── ioctl.rs
```

这样做有两个好处：

- Linux 兼容常量和结构体不会污染内核内部抽象。
- 后续如果要支持不同 ABI，层次仍然清楚。

### 9.3 错误码映射

内核内部建议使用自己的错误类型，例如：

```rust
pub enum KernelError {
    InvalidArgument,
    NotFound,
    WouldBlock,
    NoMemory,
    NotSupported,
}
```

然后在 Linux ABI 边界统一映射为：

- `EINVAL`
- `ENOENT`
- `EAGAIN`
- `ENOMEM`
- `ENOSYS`

不要让内核内部所有模块直接返回 Linux errno 数字，这会严重污染设计。

## 10. 用户态装载模块

### 10.1 `user/`

`user/` 模块负责把可执行文件真正装载进进程地址空间。建议拆分：

```text
user/
├── elf.rs
├── loader.rs
├── stack.rs
├── auxv.rs
└── entry.rs
```

### 10.2 关键职责

需要完成：

- ELF 头解析
- 段映射
- 用户栈构造
- `argv/envp` 布局
- `auxv` 填充
- 程序入口点设置

### 10.3 与其他模块的关系

`user/` 依赖：

- `fs/` 读取可执行文件
- `memory/` 建立映射
- `abi/linux` 生成兼容的 `auxv`
- `task/` 创建新进程上下文

这里是 `execve` 路径的核心交汇点。

## 11. 文件系统模块

### 11.1 `fs/`

建议拆分为两层：

```text
fs/
├── vfs/
├── tmpfs/
├── devfs/
├── procfs/
└── ext4/
```

其中：

- `vfs/` 提供统一抽象
- `tmpfs/` 用于早期可写文件系统
- `devfs/` 提供设备节点
- `procfs/` 提供 Linux 兼容观察接口
- `ext4/` 作为后续真实磁盘文件系统

### 11.2 核心对象

建议定义：

```rust
pub trait Inode;
pub struct Dentry;
pub struct File;
pub struct FileTable;
pub struct MountNamespace;
```

这里的 `FileTable` 应归属进程或线程组所有，供 `dup/dup3/pipe2` 等 syscall 使用。

### 11.3 `procfs` 的定位

`procfs` 不只是调试工具，它是 Linux 兼容的重要组成部分。建议从一开始明确它是兼容层的一部分，而不是附属功能。

早期最小实现可以优先支持：

- `/proc/self`
- `/proc/self/maps`
- `/proc/meminfo`
- `/proc/cpuinfo`

## 12. IPC 与同步模块

### 12.1 `ipc/`

建议最小包含：

- pipe
- unix domain socket
- 共享内存占位
- 事件通知抽象

### 12.2 `futex` 的归属

`futex` 虽然与同步相关，但更贴近任务调度和线程等待唤醒，因此建议放在 `task/futex.rs`，由 `syscall/` 对外暴露。

这样能避免同步原语与调度器分家，导致状态管理分裂。

## 13. 网络模块

### 13.1 `net/`

早期网络建议采用清晰分层：

```text
net/
├── nic.rs
├── packet.rs
├── ip.rs
├── tcp.rs
├── udp.rs
└── socket.rs
```

### 13.2 与 Linux 兼容的关系

Linux 程序实际看到的是 socket 语义，因此网络模块对上提供的重点不是“协议实现多漂亮”，而是：

- `socket`
- `bind`
- `listen`
- `accept`
- `connect`
- `send/recv`
- `poll/epoll` 上的可读写事件

## 14. 驱动模块

### 14.1 `driver/`

建议把驱动分成三层：

- 总线与发现
- 设备通用接口
- 具体驱动实现

例如：

```text
driver/
├── virtio/
├── block/
├── net/
├── gpu/
├── input/
└── clock/
```

### 14.2 早期优先级

建议顺序如下：

1. 串口
2. framebuffer
3. 定时器
4. `virtio-blk`
5. `virtio-net`

## 15. 核心数据流

### 15.1 启动数据流

```text
bootloader -> boot::BootContext -> arch::init -> memory::init -> console::init -> task::init
```

### 15.2 `execve` 数据流

```text
syscall::execve
  -> fs::vfs 打开文件
  -> user::elf 解析 ELF
  -> memory::AddressSpace 建立映射
  -> user::stack 构造用户栈
  -> task::Process/Thread 替换执行上下文
  -> arch::switch_to_user
```

### 15.3 `read` 数据流

```text
syscall::read
  -> 当前线程定位所属进程
  -> 进程文件描述符表查找 File
  -> fs::File::read
  -> copy_to_user
```

### 15.4 `clone` 数据流

```text
syscall::clone
  -> task 模块解析 clone 标志
  -> 共享或复制地址空间/文件表/信号处理状态
  -> 创建 Thread 或 Process
  -> 放入调度队列
```

## 16. 当前代码的演进建议

结合当前仓库现状，建议分三步整理 [`kairo-kernel/src/main.rs`](/Users/hjr/Desktop/Kairo/kairo-kernel/src/main.rs)。

### 16.1 第一步：把启动入口瘦身

当前 `main.rs` 中直接包含了：

- 启动日志
- framebuffer 探测
- 绘图测试
- 空闲循环

建议先把这些内容拆到：

- `boot/`
- `console/`
- `diag/`

让 `main.rs` 只保留高层启动流程。

### 16.2 第二步：引入统一启动上下文

避免业务逻辑直接操作 `BootInfo`，改为先转换成 `BootContext`，再把它传给各初始化模块。

### 16.3 第三步：建立内核初始化阶段

建议把启动流程拆成：

1. `early_init`
2. `memory_init`
3. `device_init`
4. `task_init`
5. `late_init`

这样后续插入中断、页分配、任务系统时不会把入口重新写乱。

## 17. 推荐的近期落地顺序

如果按当前代码继续推进，建议优先实现以下内容：

1. 重构 `main.rs`，引入 `boot/console/diag` 模块。
2. 建立 `memory/` 基础骨架，至少先有地址和页分配抽象。
3. 建立 `task/` 基础骨架，定义 `Process` 和 `Thread` 占位结构。
4. 建立 `syscall/` 编号分发框架，即使先返回 `ENOSYS` 也值得先搭起来。
5. 建立 `user/elf` 解析骨架，为后续 `execve` 做准备。

## 18. 总结

Kairo 的关键不在于模块数量多，而在于从一开始就把“内核内部实现”和“Linux 兼容边界”分开。

最重要的架构结论有三点：

- `arch`、`memory`、`task`、`fs` 是内核基础骨架。
- `syscall` 和 `abi/linux` 是 Linux 兼容能力的主要边界层。
- `user/elf`、`procfs`、`futex`、`signal` 将是系统从“能启动”走向“能跑程序”的关键节点。

后续如果继续推进，下一份最值得补的文档是：

- [`docs/roadmap.md`](/Users/hjr/Desktop/Kairo/docs/roadmap.md)，把架构拆成具体迭代任务。
