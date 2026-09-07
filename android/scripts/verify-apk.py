#!/usr/bin/env python3
"""Verify an assembled APK against package.json, AGP metadata and Android tools."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
APPLICATION_ID = "com.dbchbin.ompgui.remote"
REQUIRED_ASSETS = {"assets/preview/mermaid.min.js", "assets/preview/prism.min.js"}
LIBRARY_ASSETS = {
    "assets/dexopt/baseline.prof",
    "assets/dexopt/baseline.profm",
    "assets/mlkit_barcode_models/barcode_ssd_mobilenet_v1_dmp25_quant.tflite",
    "assets/mlkit_barcode_models/oned_auto_regressor_mobile.tflite",
    "assets/mlkit_barcode_models/oned_feature_extractor_mobile.tflite",
}


def command(*args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        raise ValueError(f"{Path(args[0]).name} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout


def source_version_code():
    source = (ROOT / "android/app/build.gradle").read_text()
    source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.DOTALL)
    declarations = re.findall(r"^\s*versionCode\b([^\n]*)", source, re.MULTILINE)
    if len(declarations) != 1 or not re.fullmatch(r"\s*(?:=\s*)?[0-9]+\s*;?\s*", declarations[0]):
        raise ValueError("Expected one literal Android versionCode in android/app/build.gradle")
    code = int(re.search(r"[0-9]+", declarations[0])[0])
    if not 1 <= code <= 2100000000:
        raise ValueError("Source Android versionCode is outside the Android range")
    return code


def verify_metadata(metadata, version, expected_code):
    if metadata.get("applicationId") != APPLICATION_ID:
        raise ValueError("APK metadata applicationId does not match ompgui")
    elements = metadata.get("elements", [])
    if len(elements) != 1:
        raise ValueError("Expected exactly one universal APK in output-metadata.json")
    element = elements[0]
    if element.get("versionName") != version:
        raise ValueError(f"APK versionName must match package.json ({version})")
    code = element.get("versionCode")
    if type(code) is not int or not 1 <= code <= 2100000000:
        raise ValueError("APK versionCode must be an integer between 1 and 2100000000")
    if code != expected_code:
        raise ValueError(f"APK versionCode must match android/app/build.gradle ({expected_code})")
    return element


def verify_assets(apk):
    with zipfile.ZipFile(apk) as archive:
        assets = {name for name in archive.namelist() if name.startswith("assets/") and not name.endswith("/")}
        missing = REQUIRED_ASSETS - assets
        extra = assets - REQUIRED_ASSETS - LIBRARY_ASSETS
        if missing or extra:
            raise ValueError(f"APK preview assets mismatch; missing={sorted(missing)}, obsolete/unexpected={sorted(extra)}")
        if any(archive.getinfo(name).file_size == 0 for name in REQUIRED_ASSETS):
            raise ValueError("APK preview assets must not be empty")


def verify_history(code, version):
    if command("git", "rev-parse", "--is-shallow-repository").strip() != "false":
        raise ValueError("Monotonic versionCode verification needs full git history and tags")
    for tag in command("git", "tag", "--merged", "HEAD", "--list", "v*").splitlines():
        if tag == f"v{version}":
            continue
        historical = subprocess.run(["git", "show", f"{tag}:android/app/build.gradle"], cwd=ROOT, text=True, capture_output=True)
        if historical.returncode:
            # Releases predating the native Android application have no code to compare.
            continue
        match = re.search(r"\bversionCode\s+(\d+)\b", historical.stdout)
        if not match:
            raise ValueError(f"Cannot determine historical Android versionCode at {tag}")
        if code <= int(match[1]):
            raise ValueError(f"APK versionCode {code} must exceed {tag}'s versionCode {match[1]}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path, help="APK or AGP output-metadata.json beside the APK")
    parser.add_argument("--aapt", default="aapt")
    parser.add_argument("--apksigner", default="apksigner")
    parser.add_argument("--expected-cert-sha256", default=os.environ.get("ANDROID_EXPECTED_CERT_SHA256", ""))
    parser.add_argument("--release", action="store_true", help="Reject debuggable APKs and Android debug signing certificates")
    parser.add_argument("--check-history", action="store_true", help="Require code greater than all prior ancestor release tags")
    parser.add_argument("--sha256-file", type=Path, help="Require a sha256sum/shasum sidecar naming this APK")
    args = parser.parse_args()
    try:
        version = json.loads((ROOT / "package.json").read_text())["version"]
        element = None
        if args.artifact.suffix == ".apk":
            apk = args.artifact.resolve()
        else:
            element = verify_metadata(json.loads(args.artifact.read_text()), version, source_version_code())
            apk = (args.artifact.parent / element["outputFile"]).resolve()
            if apk.parent != args.artifact.parent.resolve() or apk.suffix != ".apk":
                raise ValueError("Metadata outputFile must name an APK beside the metadata")
        if args.sha256_file:
            checksum = re.fullmatch(r"([0-9a-fA-F]{64}) [ *]([^\r\n]+)\n?", args.sha256_file.read_text())
            if not checksum or checksum[2] != apk.name:
                raise ValueError("SHA-256 sidecar must contain exactly one checksum naming this APK")
            with apk.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != checksum[1].lower():
                    raise ValueError("APK SHA-256 does not match its uploaded checksum sidecar")
        badging = command(args.aapt, "dump", "badging", str(apk))
        package = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging, re.MULTILINE)
        if not package:
            raise ValueError("aapt did not report an APK package/version")
        actual = verify_metadata({"applicationId": package[1], "elements": [{"versionCode": int(package[2]), "versionName": package[3]}]}, version, source_version_code())
        if element is not None and actual["versionCode"] != element["versionCode"]:
            raise ValueError("Actual APK versionCode does not match output metadata")
        element = actual
        if args.release and re.search(r"^application-debuggable(?:\s|$)", badging, re.MULTILINE):
            raise ValueError("Release APK must not be debuggable")
        signatures = command(args.apksigner, "verify", "--verbose", "--print-certs", str(apk))
        certificates = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$", signatures, re.MULTILINE)
        if not certificates:
            raise ValueError("apksigner did not verify an APK signing certificate")
        if args.release:
            subjects = re.findall(r"^Signer #\d+ certificate DN: (.+)$", signatures, re.MULTILINE)
            if len(subjects) != len(certificates):
                raise ValueError("Cannot determine release signing certificate subjects")
            if any(re.search(r"(?:^|,)\s*CN\s*=\s*Android Debug\s*(?:,|$)", subject, re.IGNORECASE) for subject in subjects):
                raise ValueError("Release APK must not use an Android debug signing certificate")
        if args.expected_cert_sha256:
            expected = args.expected_cert_sha256.replace(":", "").strip().lower()
            if not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise ValueError("ANDROID_EXPECTED_CERT_SHA256 must be a SHA-256 certificate fingerprint")
            if {cert.lower() for cert in certificates} != {expected}:
                raise ValueError("APK signing certificate does not match ANDROID_EXPECTED_CERT_SHA256")
        verify_assets(apk)
        if args.check_history:
            verify_history(element["versionCode"], version)
        print(f"Verified {apk.name}: {version} ({element['versionCode']}), signed, verified preview and library assets")
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        print(f"APK verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
