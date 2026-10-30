import Foundation

struct LauncherDirectories {
    let support: URL
    let logs: URL
}

// Keep the legacy save key and launch lock shared with an existing runtime.
func launcherDirectories(home: URL, exists: (String) -> Bool = FileManager.default.fileExists(atPath:)) -> LauncherDirectories {
    let legacySupport = home.appendingPathComponent("Library/Application Support/Slide Studio", isDirectory: true)
    let storageName = exists(legacySupport.path) ? "Slide Studio" : "Keytist"
    return LauncherDirectories(
        support: home.appendingPathComponent("Library/Application Support/\(storageName)", isDirectory: true),
        logs: home.appendingPathComponent("Library/Logs/\(storageName)", isDirectory: true)
    )
}

func isEditorPage(_ html: String) -> Bool {
    // Accept both names so a renamed launcher can reuse an older running server.
    let pattern = #"<title\b[^>]*>\s*(?:Keytist|Slide Studio)(?=\s*(?:</title\s*>|[·–—|:-]))"#
    return html.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
}
