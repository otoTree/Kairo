// 串口输出模块（用于调试）
use core::fmt;
use spin::Mutex;
use lazy_static::lazy_static;
use x86_64::instructions::port::Port;

lazy_static! {
    pub static ref SERIAL1: Mutex<SerialPort> = {
        let mut serial_port = unsafe { SerialPort::new(0x3F8) };
        serial_port.init();
        Mutex::new(serial_port)
    };
}

pub struct SerialPort {
    data: Port<u8>,
    int_en: Port<u8>,
    fifo_ctrl: Port<u8>,
    line_ctrl: Port<u8>,
    modem_ctrl: Port<u8>,
    line_status: Port<u8>,
}

impl SerialPort {
    pub unsafe fn new(base: u16) -> SerialPort {
        SerialPort {
            data: Port::new(base),
            int_en: Port::new(base + 1),
            fifo_ctrl: Port::new(base + 2),
            line_ctrl: Port::new(base + 3),
            modem_ctrl: Port::new(base + 4),
            line_status: Port::new(base + 5),
        }
    }

    pub fn init(&mut self) {
        unsafe {
            // 禁用中断
            self.int_en.write(0x00);
            // 启用 DLAB（设置波特率）
            self.line_ctrl.write(0x80);
            // 设置波特率为 38400（除数 = 3）
            self.data.write(0x03);
            self.int_en.write(0x00);
            // 8 位，无奇偶校验，1 个停止位
            self.line_ctrl.write(0x03);
            // 启用 FIFO，清除队列，14 字节阈值
            self.fifo_ctrl.write(0xC7);
            // IRQs 启用，RTS/DSR 设置
            self.modem_ctrl.write(0x0B);
        }
    }

    fn is_transmit_empty(&mut self) -> bool {
        unsafe { self.line_status.read() & 0x20 != 0 }
    }

    pub fn send(&mut self, data: u8) {
        while !self.is_transmit_empty() {}
        unsafe {
            self.data.write(data);
        }
    }
}

impl fmt::Write for SerialPort {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        for byte in s.bytes() {
            self.send(byte);
        }
        Ok(())
    }
}

#[doc(hidden)]
pub fn _print(args: fmt::Arguments) {
    use core::fmt::Write;
    SERIAL1.lock().write_fmt(args).expect("串口打印失败");
}

#[macro_export]
macro_rules! serial_print {
    ($($arg:tt)*) => ($crate::serial::_print(format_args!($($arg)*)));
}

#[macro_export]
macro_rules! serial_println {
    () => ($crate::serial_print!("\n"));
    ($($arg:tt)*) => ($crate::serial_print!("{}\n", format_args!($($arg)*)));
}
