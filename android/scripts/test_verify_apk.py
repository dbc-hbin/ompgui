import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("verify_apk", Path(__file__).with_name("verify-apk.py"))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ApkVerificationTests(unittest.TestCase):
    def test_wrong_package_version_is_rejected(self):
        metadata = {"applicationId": verifier.APPLICATION_ID, "elements": [{"versionName": "0.7.2", "versionCode": 703}]}
        with self.assertRaisesRegex(ValueError, "versionName must match"):
            verifier.verify_metadata(metadata, "0.7.3", 703)

    def test_version_code_android_boundary(self):
        for code in (0, 2100000001, True, "703"):
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, "versionCode must be an integer"):
                verifier.verify_metadata({"applicationId": verifier.APPLICATION_ID, "elements": [{"versionName": "0.7.3", "versionCode": code}]}, "0.7.3", 703)

    def test_current_source_code_is_required_even_with_matching_name(self):
        with self.assertRaisesRegex(ValueError, "versionCode must match"):
            verifier.verify_metadata({"applicationId": verifier.APPLICATION_ID, "elements": [{"versionName": "0.7.3", "versionCode": 704}]}, "0.7.3", 703)

    def test_source_code_parser_rejects_ambiguous_or_computed_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "android/app").mkdir(parents=True)
            gradle = root / "android/app/build.gradle"
            with patch.object(verifier, "ROOT", root):
                gradle.write_text("// versionCode 999\n/* versionCode 888 */\nversionCode 703\n")
                self.assertEqual(verifier.source_version_code(), 703)
                for declaration in ("versionCode 703 + 1", "versionCode project.code", "versionCode 703\nversionCode 704"):
                    gradle.write_text(declaration)
                    with self.subTest(declaration=declaration), self.assertRaises(ValueError):
                        verifier.source_version_code()

    def test_cli_current_code_and_release_policy(self):
        cases = (
            ("direct wrong code", False, 704, False, "ompgui Release", False, "versionCode must match"),
            ("metadata wrong code", True, 704, False, "ompgui Release", False, "versionCode must match"),
            ("debug CI", False, 703, True, "Android Debug", False, None),
            ("debuggable release", False, 703, True, "ompgui Release", True, "must not be debuggable"),
            ("debug key release", False, 703, False, "Android Debug", True, "debug signing certificate"),
            ("signed release", False, 703, False, "ompgui Release", True, None),
            ("signed metadata release", True, 703, False, "ompgui Release", True, None),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "android/app").mkdir(parents=True)
            (root / "android/app/build.gradle").write_text("versionCode 703\n")
            (root / "package.json").write_text('{"version":"0.7.3"}')
            apk = root / "app.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                for asset in verifier.REQUIRED_ASSETS:
                    archive.writestr(asset, "preview code")
            metadata = root / "output-metadata.json"
            for label, use_metadata, code, debuggable, subject, release, error in cases:
                with self.subTest(case=label):
                    metadata.write_text(json.dumps({"applicationId": verifier.APPLICATION_ID, "elements": [{"versionName": "0.7.3", "versionCode": code, "outputFile": apk.name}]}))
                    badging = f"package: name='{verifier.APPLICATION_ID}' versionCode='{code}' versionName='0.7.3'\n"
                    if debuggable:
                        badging += "application-debuggable\n"
                    signature = f"Signer #1 certificate DN: CN={subject}, O=Android, C=US\nSigner #1 certificate SHA-256 digest: {'a' * 64}\n"
                    argv = ["verify-apk.py", str(metadata if use_metadata else apk), "--expected-cert-sha256", "a" * 64]
                    if release:
                        argv.append("--release")
                    errors = io.StringIO()
                    with patch.object(verifier, "ROOT", root), patch.object(verifier, "command", side_effect=[badging, signature]), patch("sys.argv", argv), contextlib.redirect_stderr(errors), contextlib.redirect_stdout(io.StringIO()):
                        result = verifier.main()
                    self.assertEqual(result, 1 if error else 0, errors.getvalue())
                    if error:
                        self.assertIn(error, errors.getvalue())

    def test_real_merged_library_assets_pass_but_unknown_library_files_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory) / "app.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                for name in (
                    "assets/preview/mermaid.min.js", "assets/preview/prism.min.js",
                    "assets/dexopt/baseline.prof", "assets/dexopt/baseline.profm",
                    "assets/mlkit_barcode_models/barcode_ssd_mobilenet_v1_dmp25_quant.tflite",
                    "assets/mlkit_barcode_models/oned_auto_regressor_mobile.tflite",
                    "assets/mlkit_barcode_models/oned_feature_extractor_mobile.tflite",
                ):
                    archive.writestr(name, "packaged content")
            verifier.verify_assets(apk)
            with zipfile.ZipFile(apk, "a") as archive:
                archive.writestr("assets/mlkit_barcode_models/stale.js", "obsolete content")
            with self.assertRaisesRegex(ValueError, "obsolete/unexpected=.*stale.js"):
                verifier.verify_assets(apk)

    def test_obsolete_capacitor_asset_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory) / "app.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                for asset in verifier.REQUIRED_ASSETS:
                    archive.writestr(asset, "preview code")
                archive.writestr("assets/public/index.html", "stale Capacitor shell")
            with self.assertRaisesRegex(ValueError, "obsolete/unexpected=.*assets/public/index.html"):
                verifier.verify_assets(apk)

    def test_missing_preview_asset_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory) / "app.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("assets/preview/prism.min.js", "preview code")
            with self.assertRaisesRegex(ValueError, "missing=.*mermaid.min.js"):
                verifier.verify_assets(apk)

    def test_changed_apk_fails_checksum_before_android_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "android/app").mkdir(parents=True)
            (root / "android/app/build.gradle").write_text("android {\n defaultConfig {\n versionCode 703\n }\n}\n")
            (root / "package.json").write_text('{"version":"0.7.3"}')
            apk = root / "ompgui-remote-v0.7.3.apk"
            apk.write_bytes(b"changed artifact")
            checksum = root / (apk.name + ".sha256")
            checksum.write_text("0" * 64 + "  " + apk.name + "\n")
            errors = io.StringIO()
            with patch.object(verifier, "ROOT", root), patch("sys.argv", ["verify-apk.py", str(apk), "--sha256-file", str(checksum)]), contextlib.redirect_stderr(errors):
                result = verifier.main()
            self.assertEqual(result, 1)
            self.assertIn("APK SHA-256 does not match", errors.getvalue())

    def test_unsigned_apk_fails_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "android/app").mkdir(parents=True)
            (root / "android/app/build.gradle").write_text("android {\n defaultConfig {\n versionCode 703\n }\n}\n")
            (root / "package.json").write_text('{"version":"0.7.3"}')
            metadata = root / "output-metadata.json"
            metadata.write_text(json.dumps({"applicationId": verifier.APPLICATION_ID, "elements": [{"versionName": "0.7.3", "versionCode": 703, "outputFile": "app.apk"}]}))
            # Exercise the real process exit boundary: an unsigned APK makes apksigner exit nonzero.
            aapt = root / "aapt"
            aapt.write_text("#!/bin/sh\nprintf \"package: name='com.dbchbin.ompgui.remote' versionCode='703' versionName='0.7.3'\\n\"\n")
            signer = root / "apksigner"
            signer.write_text("#!/bin/sh\necho 'DOES NOT VERIFY: Missing META-INF/MANIFEST.MF' >&2\nexit 1\n")
            aapt.chmod(0o700)
            signer.chmod(0o700)
            errors = io.StringIO()
            with patch.object(verifier, "ROOT", root), patch("sys.argv", ["verify-apk.py", str(metadata), "--aapt", str(aapt), "--apksigner", str(signer)]), contextlib.redirect_stderr(errors):
                result = verifier.main()
            self.assertEqual(result, 1)
            self.assertIn("apksigner failed", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
