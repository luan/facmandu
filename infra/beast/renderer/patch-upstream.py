#!/usr/bin/env python3
"""Small compatibility/resource patches against the pinned upstream source."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
p = root / 'Java-Factorio-Data-Wrapper/FactorioDataWrapper/src/com/demod/factorio/DataTable.java'
s = p.read_text()
old = '.filter(bonus -> bonus.getName().startsWith(bonusMatch))'
assert old in s
p.write_text(s.replace(old, '.filter(bonus -> bonus.getName().matches(java.util.regex.Pattern.quote(bonusMatch) + "[0-9]+"))'))
# The standalone renderer only needs icons referenced by its input, not a complete portal gallery.
p = root / 'Factorio-FBSR/FactorioBlueprintStringRenderer/src/com/demod/fbsr/IconManager.java'
s = p.read_text()
old = 'public static final int ICON_SIZE = 64;'
assert old in s
s = s.replace(old, old + '\n\tprivate static final java.util.Set<String> FACMANDU_ICONS = new org.json.JSONArray(System.getProperty("facmandu.icons", "[]")).toList().stream().map(Object::toString).collect(java.util.stream.Collectors.toSet());')
old = 'DataPrototype proto = entry.getValue();'
assert s.count(old) == 2
s = s.replace(old, 'if (!FACMANDU_ICONS.contains(entry.getKey())) continue;\n\t\t\t\t' + old)
p.write_text(s)
# Load only the requested ZIP entry; expanding an entire multi-GB graphics mod defeats the heap cap.
p = root / 'Java-Factorio-Data-Wrapper/FactorioDataWrapper/src/com/demod/factorio/ModLoader.java'
s = p.read_text()
start = s.index('\t\t@Override\n\t\tpublic synchronized Optional<InputStream> getResource(String path)')
end = s.index('\n\t}\n\n\tprivate static final Logger', start)
s = s[:start] + '''\t\t@Override
        public synchronized Optional<InputStream> getResource(String path) {
            String wanted = path.replace("\\\\", "/").replace("//", "/");
            try (ZipFile archive = new ZipFile(fileZip)) {
                ZipEntry entry = archive.stream().filter(e -> stripDirectoryName(e.getName()).equals(wanted)).findFirst().orElse(null);
                if (entry == null) return Optional.empty();
                try (InputStream stream = archive.getInputStream(entry)) {
                    return Optional.of(new ByteArrayInputStream(ByteStreams.toByteArray(stream)));
                }
            } catch (IOException failure) {
                throw new RuntimeException(failure);
            }
        }
''' + s[end:]
s = s.replace('\t\tprivate volatile boolean loaded = false;\n', '').replace('\t\tprivate final Map<String, byte[]> files = new LinkedHashMap<>();\n', '')
p.write_text(s)
# Grid labels must identify blueprint coordinates, not ordinal columns that lose the world offset.
p = root / 'Factorio-FBSR/FactorioBlueprintStringRenderer/src/com/demod/fbsr/map/MapGrid.java'
s = p.read_text()
old = 'String.format("%02d", (int) Math.round(i) % 100)'
assert s.count(old) == 2
s = s.replace(old, 'Integer.toString((int)x)', 1).replace(old, 'Integer.toString((int)y)', 1)
p.write_text(s)
