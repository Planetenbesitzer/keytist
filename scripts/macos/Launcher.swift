import AppKit
import Foundation
import Darwin

struct LauncherConfiguration: Decodable {
    let repositoryPath: String
    let nodePath: String
    let localURL: String
    let defaultOutputDirectory: String
}

enum LauncherError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

enum ServerState: String {
    case ready, unavailable, occupied
}

final class ProbeResult {
    var data: Data?
    var response: HTTPURLResponse?
}

func serverState(at url: URL) -> ServerState {
    let result = ProbeResult()
    let completed = DispatchSemaphore(value: 0)
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1)
    request.httpMethod = "GET"
    let task = URLSession.shared.dataTask(with: request) { data, response, _ in
        result.data = data
        result.response = response as? HTTPURLResponse
        completed.signal()
    }
    task.resume()
    if completed.wait(timeout: .now() + 1.5) == .timedOut {
        task.cancel()
        return .unavailable
    }
    guard let response = result.response else { return .unavailable }
    let html = String(data: result.data ?? Data(), encoding: .utf8) ?? ""
    return response.statusCode == 200 && html.contains("<title>Slide Studio") ? .ready : .occupied
}

func readConfiguration() throws -> LauncherConfiguration {
    guard let resource = Bundle.main.resourceURL?.appendingPathComponent("launcher.json") else {
        throw LauncherError.message("启动器配置缺失，请重新安装 Slide Studio。")
    }
    let config = try JSONDecoder().decode(LauncherConfiguration.self, from: Data(contentsOf: resource))
    let manager = FileManager.default
    guard manager.isExecutableFile(atPath: config.nodePath) else {
        throw LauncherError.message("本机运行程序的位置已变化，请重新运行 Slide Studio 安装脚本。")
    }
    guard manager.fileExists(atPath: config.repositoryPath + "/scripts/serve.mjs"),
          manager.fileExists(atPath: config.repositoryPath + "/dist/index.html") else {
        throw LauncherError.message("未找到 Slide Studio 文件。若移动了项目，请在新位置重新运行安装脚本。")
    }
    return config
}

func appendLog(_ text: String, to url: URL) {
    let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(text)\n"
    guard let data = line.data(using: .utf8) else { return }
    if !FileManager.default.fileExists(atPath: url.path) {
        FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
    }
    guard let file = try? FileHandle(forWritingTo: url) else { return }
    defer { try? file.close() }
    _ = try? file.seekToEnd()
    try? file.write(contentsOf: data)
}

func ensureServer(_ config: LauncherConfiguration, url: URL) throws {
    let manager = FileManager.default
    let support = manager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Slide Studio", isDirectory: true)
    let logs = manager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Slide Studio", isDirectory: true)
    try manager.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try manager.createDirectory(at: logs, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try manager.createDirectory(atPath: config.defaultOutputDirectory, withIntermediateDirectories: true)
    let log = logs.appendingPathComponent("launcher.log")
    let lockPath = support.appendingPathComponent("launcher.lock").path
    let lock = Darwin.open(lockPath, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard lock >= 0 else { throw LauncherError.message("无法准备本地启动记录，请检查用户文件夹的权限。") }
    defer {
        flock(lock, LOCK_UN)
        Darwin.close(lock)
    }
    guard flock(lock, LOCK_EX) == 0 else { throw LauncherError.message("另一个启动器正在运行，请稍后重试。") }

    switch serverState(at: url) {
    case .ready:
        appendLog("Reused existing server at \(config.localURL)", to: log)
        return
    case .occupied:
        throw LauncherError.message("本地端口 4178 已被其他程序占用，请退出占用程序后重试。")
    case .unavailable:
        break
    }

    let serverLog = logs.appendingPathComponent("server.log")
    if !manager.fileExists(atPath: serverLog.path) {
        manager.createFile(atPath: serverLog.path, contents: nil, attributes: [.posixPermissions: 0o600])
    }
    let output = try FileHandle(forWritingTo: serverLog)
    defer { try? output.close() }
    _ = try output.seekToEnd()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: config.nodePath)
    process.arguments = [config.repositoryPath + "/scripts/serve.mjs"]
    process.currentDirectoryURL = URL(fileURLWithPath: config.repositoryPath, isDirectory: true)
    var environment = ProcessInfo.processInfo.environment
    environment["STUDIO_PORT"] = "4178"
    environment["STUDIO_OUTPUT_DIR"] = config.defaultOutputDirectory
    process.environment = environment
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = output
    process.standardError = output
    try process.run()
    appendLog("Started server PID \(process.processIdentifier) at \(config.localURL)", to: log)
    let deadline = Date().addingTimeInterval(12)
    repeat {
        switch serverState(at: url) {
        case .ready: return
        case .occupied:
            throw LauncherError.message("本地端口 4178 已被其他程序占用，请退出占用程序后重试。")
        case .unavailable: break
        }
        if !process.isRunning {
            throw LauncherError.message("Slide Studio 未能启动。请查看用户资源库中 Logs/Slide Studio/server.log。")
        }
        Thread.sleep(forTimeInterval: 0.2)
    } while Date() < deadline
    throw LauncherError.message("Slide Studio 启动超时，请稍后重新打开。")
}

let arguments = Set(CommandLine.arguments.dropFirst())
do {
    let config = try readConfiguration()
    guard let url = URL(string: config.localURL), url.absoluteString == "http://127.0.0.1:4178" else {
        throw LauncherError.message("本地地址配置无效，请重新安装 Slide Studio。")
    }
    if arguments.contains("--check") {
        let result: [String: Any] = ["application": Bundle.main.bundlePath, "node": config.nodePath, "repository": config.repositoryPath, "url": config.localURL, "defaultOutputDirectory": config.defaultOutputDirectory, "server": serverState(at: url).rawValue]
        let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } else {
        try ensureServer(config, url: url)
        if !arguments.contains("--no-open") {
            guard NSWorkspace.shared.open(url) else { throw LauncherError.message("无法打开默认浏览器，请在浏览器访问 http://127.0.0.1:4178。") }
            let log = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Slide Studio/launcher.log")
            appendLog("Opened default browser at \(config.localURL)", to: log)
        }
    }
} catch {
    let text = error.localizedDescription
    FileHandle.standardError.write(Data((text + "\n").utf8))
    if !arguments.contains("--check") && !arguments.contains("--no-open") {
        NSApplication.shared.setActivationPolicy(.accessory)
        NSApplication.shared.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "无法启动 Slide Studio"
        alert.informativeText = text
        alert.addButton(withTitle: "好")
        alert.runModal()
    }
    exit(1)
}
