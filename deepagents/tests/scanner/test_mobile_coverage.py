from pathlib import Path

from tools.common.capabilities.evidence.scanner.analyzers.adapters import DartLanguageAdapter, ObjectiveCLanguageAdapter, SwiftLanguageAdapter
from tools.common.capabilities.evidence.scanner.frameworks import FrameworkAdapterRegistry
from tools.common.capabilities.evidence.scanner.inventory.project.project_discovery import ProjectDiscovery


def write(path: Path, value: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def test_mobile_languages_extract_symbols_and_static_entry_evidence(tmp_path: Path):
    write(tmp_path / "App.swift", "import SwiftUI\n@main struct MyApp: App {}\nstruct HomeView: View {}")
    write(tmp_path / "AppDelegate.m", "#import <UIKit/UIKit.h>\n@interface AppDelegate : UIResponder @end")
    write(tmp_path / "lib/main.dart", "import 'package:flutter/material.dart';\nclass HomePage extends StatelessWidget {}\nvoid main(){ runApp(HomePage()); }")
    swift = SwiftLanguageAdapter().analyze(tmp_path, ["App.swift"])
    objc = ObjectiveCLanguageAdapter().analyze(tmp_path, ["AppDelegate.m"])
    dart = DartLanguageAdapter().analyze(tmp_path, ["lib/main.dart"])
    assert any(node.label == "MyApp" for node in swift.native_result.semantic_program.nodes)
    assert any(node.label == "AppDelegate" for node in objc.native_result.semantic_program.nodes)
    assert any(node.label == "HomePage" for node in dart.native_result.semantic_program.nodes)
    assert any(node.attributes.get("mobileRole") == "application" for node in dart.native_result.semantic_program.nodes)


def test_mobile_framework_detection_is_evidence_bound_and_navigation_is_canonical(tmp_path: Path):
    write(tmp_path / "rn/package.json", '{"name":"rn","dependencies":{"react-native":"0.75.0"}}')
    write(tmp_path / "rn/App.tsx", 'function App(){ navigation.navigate("Profile"); } function Profile(){}')
    write(tmp_path / "flutter/pubspec.yaml", "name: flutter_app\ndependencies:\n  flutter:\n    sdk: flutter\n")
    write(tmp_path / "flutter/lib/main.dart", "void main(){runApp(HomePage());}\nclass HomePage extends StatelessWidget {}")
    discovery = ProjectDiscovery().discover(tmp_path)
    registry = FrameworkAdapterRegistry.default()
    rn_project = next(project for project in discovery.projects if project.relative_root == "rn")
    flutter_project = next(project for project in discovery.projects if project.relative_root == "flutter")
    rn_result = type("Result", (), {"language": "typescript", "native_result": type("Native", (), {"semantic_program": type("Program", (), {"nodes": [], "edges": [], "unresolved_frontiers": []})()})()})()
    assert registry.detect(rn_project, tmp_path, rn_result) == ("react_native",)
    flutter_result = type("Result", (), {"language": "dart", "native_result": DartLanguageAdapter().analyze(tmp_path, ["flutter/lib/main.dart"]).native_result})()
    assert registry.detect(flutter_project, tmp_path, flutter_result) == ("flutter",)


def test_ios_and_android_projects_are_discovered_without_toolchains(tmp_path: Path):
    (tmp_path / "ios/App.xcodeproj").mkdir(parents=True)
    write(tmp_path / "ios/App.swift", "@main struct App: App {}")
    write(tmp_path / "android/src/main/AndroidManifest.xml", "<manifest><application><activity android:name=\".MainActivity\" /></application></manifest>")
    write(tmp_path / "android/src/main/MainActivity.kt", "class MainActivity : Activity()")
    result = ProjectDiscovery().discover(tmp_path)
    assert any(project.project_kind == "ios" for project in result.projects)
    assert any(project.project_kind == "android" for project in result.projects)
