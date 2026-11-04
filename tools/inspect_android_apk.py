#!/usr/bin/env python3
"""Inspect an actual APK; never confuse JNI bridge packaging with the game core."""
import argparse
import json
import re
import struct
from pathlib import Path
from zipfile import ZipFile

def is_arm64_shared_elf(data):
    """Check ELF64 LE / ET_DYN / AArch64, not merely a .so filename."""
    if len(data)<64 or data[:4]!=b"\x7fELF" or data[4]!=2 or data[5]!=1:
        return False
    kind,machine=struct.unpack_from("<HH",data,16)
    return kind==3 and machine==183

def inspect_apk(apk, expected_commit):
    if not re.fullmatch(r"[a-f0-9]{40}", expected_commit):
        raise ValueError("Expected full pinned Brisk source SHA")
    with ZipFile(apk) as archive:
        entries=set(archive.namelist())
        native={x for x in entries if re.fullmatch(r"lib/[^/]+/libbriskandroid\.so",x)}
        cores={x for x in entries if re.fullmatch(r"lib/[^/]+/libbriskgame\.so",x)}
        architectures=sorted({p.split("/")[1] for p in native})
        core_architectures=sorted({p.split("/")[1] for p in cores})
        pinned_data=json.loads((Path(__file__).resolve().parent/"brisk-native-source.json").read_text())
        if pinned_data["brisk_commit"]!=expected_commit:
            raise ValueError("APK build was not inspected against the pinned source revision")
        missing=sorted(set(architectures)-set(core_architectures))
        invalid=sorted(path.split("/")[1] for path in cores
            if not is_arm64_shared_elf(archive.read(path)))
        # A mislabeled ARMv7 or placeholder file may not claim game parity.
        wrong_abi=sorted(abi for abi in core_architectures if abi!="arm64-v8a")
        valid=bool(architectures) and not missing and not invalid and not wrong_abi and bool(cores)
        return {
            "app":"Pokemon Brisk Emerald",
            "brisk_source_commit":expected_commit,
            "native_transport_abis":architectures,
            "native_game_abis":core_architectures,
            "missing_game_abis":missing,
            "invalid_game_abis":sorted(set(invalid+wrong_abi)),
            "game_integrated":valid,
            "meaning":"Presence of a native game library is necessary, not sufficient: gameplay and native save testing are also required."
        }

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk",type=Path)
    parser.add_argument("--expected-commit",required=True)
    parser.add_argument("--output",type=Path)
    parser.add_argument("--require-game",action="store_true")
    args=parser.parse_args()
    report=inspect_apk(args.apk,args.expected_commit)
    if args.output:
        args.output.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))
    if not report["native_transport_abis"]:
        parser.exit(2,"APK missing Android native JNI transport\n")
    if args.require_game and not report["game_integrated"]:
        parser.exit(3,"APK is not playable: native Brisk Emerald game core is missing\n")

if __name__=="__main__":
    main()
