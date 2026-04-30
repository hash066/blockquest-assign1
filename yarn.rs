use std::process::Command;
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let status = Command::new("cmd")
        .arg("/c")
        .arg("yarn.cmd")
        .args(&args)
        .status()
        .expect("Failed to execute yarn");
    std::process::exit(status.code().unwrap_or(1));
}
