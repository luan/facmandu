#!/usr/bin/env bash
# Build pinned upstream code, keeping Wube sprites and mod archives out of Git.
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
root="$HOME/.local/share/facmandu-renderer"
mkdir -p "$root"
staging=$(mktemp -d "$root/.install-XXXXXXXX")
trap 'rm -rf "$staging"' EXIT
checkout() {
  git clone --quiet "https://github.com/demodude4u/$1.git" "$staging/$1"
  git -C "$staging/$1" checkout --quiet "$2"
}
checkout Factorio-FBSR 2f0c698a9b92d02192e9e54c0c66c2ae59fcddad
checkout Java-Factorio-Data-Wrapper 1abd6e6bf59ea1b15817e482024c74d9ebbe8167
checkout Discord-Core-Bot-Apple 49f10ce1380d3e08a38b7c78828c738915f00769
curl --fail --silent --show-error -o "$staging/maven.tar.gz" https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.tar.gz
curl --fail --silent --show-error -o "$staging/maven.sha512" https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.tar.gz.sha512
printf '%s  %s\n' "$(cat "$staging/maven.sha512")" "$staging/maven.tar.gz" | sha512sum --check --status
tar xf "$staging/maven.tar.gz" -C "$staging"
mvn="$staging/apache-maven-3.9.11/bin/mvn"
python3 "$source_dir/patch-upstream.py" "$staging"
"$mvn" -q -f "$staging/Java-Factorio-Data-Wrapper/FactorioDataWrapper/pom.xml" install -DskipTests
"$mvn" -q -f "$staging/Discord-Core-Bot-Apple/DiscordCoreBotApple/pom.xml" install -DskipTests
project="$staging/Factorio-FBSR/FactorioBlueprintStringRenderer"
"$mvn" -q -f "$project/pom.xml" package dependency:copy-dependencies -DskipTests
mkdir "$staging/runtime" "$staging/runtime/classes" "$staging/runtime/lib"
cp "$project/target/FactorioBlueprintStringRenderer-0.0.1-SNAPSHOT.jar" "$project"/target/dependency/*.jar "$staging/runtime/lib/"
javac -cp "$staging/runtime/lib/*" -d "$staging/runtime/classes" "$source_dir/FacmanduRenderer.java"
cp "$source_dir/render.py" "$staging/runtime/"
cp "$staging/Java-Factorio-Data-Wrapper/FactorioDataWrapper/res/type-hiearchy.json" "$staging/runtime/type-hierarchy.json"
cp "$staging/Factorio-FBSR/LICENSE" "$staging/runtime/FBSR-LICENSE"
cp "$staging/Java-Factorio-Data-Wrapper/LICENSE" "$staging/runtime/FDW-LICENSE"
cp "$staging/Discord-Core-Bot-Apple/LICENSE" "$staging/runtime/DCBA-LICENSE"
release="$root/runtime-$(date -u +%Y%m%dT%H%M%SZ)"
mv "$staging/runtime" "$release"
ln -s "$release" "$root/.current-next"
mv -Tf "$root/.current-next" "$root/current"
