import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.HashSet;
import java.util.Set;
import java.util.OptionalInt;
import javax.imageio.ImageIO;
import org.json.JSONObject;
import com.demod.dcba.CommandReporting;
import com.demod.factorio.FactorioData;
import com.demod.fbsr.EntityRendererFactory;
import com.demod.fbsr.FBSR;
import com.demod.fbsr.FactorioManager;
import com.demod.fbsr.IconManager;
import com.demod.fbsr.AtlasManager;
import com.demod.fbsr.Profile;
import com.demod.fbsr.RenderRequest;
import com.demod.fbsr.bs.BSBlueprint;

/** Local files only: no HTTP listener, portal downloads or blueprint URL fetching. */
public final class FacmanduRenderer {
    private static void collectIcons(Object value, Set<String> names) {
        if (value instanceof String name) names.add(name);
        else if (value instanceof JSONObject object) {
            for (String key : object.keySet()) {
                if (!key.equals("label") && !key.equals("description")) collectIcons(object.get(key), names);
            }
        } else if (value instanceof org.json.JSONArray array) {
            for (Object element : array) collectIcons(element, names);
        }
    }

    public static void main(String[] args) {
        try {
            JSONObject input = new JSONObject(Files.readString(Path.of(args[1])));
            Set<String> icons = new HashSet<>(List.of("blueprint", "locomotive", "train-stop", "space-platform-hub", "normal", "uncommon", "rare", "epic", "legendary"));
            collectIcons(input, icons);
            System.setProperty("facmandu.icons", new org.json.JSONArray(icons).toString());
            Profile profile = Profile.vanilla();
            if (args[0].equals("icons")) {
                profile.setFactorioData(new FactorioData(profile.getFileDumpDataJson(), profile.getDumpFactorioVersion()));
                FactorioManager manager = new FactorioManager(List.of(profile));
                profile.setFactorioManager(manager);
                profile.setAtlasManager(new AtlasManager());
                if (!manager.initializePrototypes()) throw new IllegalStateException("Cannot load icon prototypes");
                IconManager iconManager = new IconManager(manager);
                manager.setIconManager(iconManager);
                iconManager.initialize();
                for (String kind : input.keySet()) {
                    Path folder = Path.of(args[2], kind);
                    Files.createDirectories(folder);
                    for (Object value : input.getJSONArray(kind)) {
                        String name = value.toString();
                        if (name.contains("/") || name.contains("\\") || name.equals(".") || name.equals("..")) continue;
                        var definitions = switch (kind) {
                            case "item" -> iconManager.lookupItem(name);
                            case "fluid" -> iconManager.lookupFluid(name);
                            case "recipe" -> iconManager.lookupRecipe(name);
                            case "entity" -> iconManager.lookupEntity(name);
                            case "technology" -> iconManager.lookupTechnology(name);
                            default -> throw new IllegalArgumentException("Unknown icon kind");
                        };
                        if (definitions.isEmpty()) continue;
                        var icon = definitions.get(0).getLoader().apply("");
                        if (!ImageIO.write(icon, "PNG", folder.resolve(name + ".png").toFile()))
                            throw new IllegalStateException("Cannot encode icon " + name);
                    }
                }
            } else if (args[0].equals("build")) {
                // Unsupported prototypes must not prevent supported layouts from rendering.
                // A requested unsupported entity is rejected below, never drawn as a placeholder.
                FactorioData data = new FactorioData(profile.getFileDumpDataJson(), profile.getDumpFactorioVersion());
                if (!data.initialize(false)) throw new IllegalStateException("Cannot load prototype dump");
                Path config = profile.getFolderProfile().toPath().resolve("profile.json");
                JSONObject json = new JSONObject(Files.readString(config));
                JSONObject blueprint = new JSONObject(Files.readString(Path.of(args[1])));
                Set<String> names = new HashSet<>();
                for (Object value : blueprint.getJSONArray("entities")) names.add(((JSONObject)value).getString("name"));
                Set<String> tiles = new HashSet<>();
                for (Object value : blueprint.optJSONArray("tiles", new org.json.JSONArray())) tiles.add(((JSONObject)value).getString("name"));
                JSONObject excluded = new JSONObject();
                for (var entity : data.getTable().getEntities().values()) {
                    var factoryClass = EntityRendererFactory.findFactoryClassByType(entity.getType());
                    if (!names.contains(entity.getName()) || factoryClass.isEmpty()) {
                        excluded.put(entity.getName(), JSONObject.NULL);
                        continue;
                    }
                    try {
                        var factory = factoryClass.get().getConstructor().newInstance();
                        factory.setProfile(profile);
                        factory.setPrototype(entity);
                        factory.initFromPrototype();
                        factory.initAtlas(def -> {});
                    } catch (Exception failure) {
                        excluded.put(entity.getName(), JSONObject.NULL);
                    }
                }
                json.put("entity-overrides", excluded);
                JSONObject excludedTiles = new JSONObject();
                for (var tile : data.getTable().getTiles().values()) {
                    if (!tiles.contains(tile.getName())) excludedTiles.put(tile.getName(), JSONObject.NULL);
                }
                json.put("tile-overrides", excludedTiles);
                Files.writeString(config, json.toString());
                if (!profile.buildAssets(false)) throw new IllegalStateException("Cannot build sprite assets");
            } else if (args[0].equals("render")) {
                if (!FBSR.load(List.of(profile))) throw new IllegalStateException("Cannot load sprite assets");
                var blueprint = new BSBlueprint(new JSONObject(Files.readString(Path.of(args[1]))));
                var reporting = new CommandReporting(null, null, Instant.now());
                var request = new RenderRequest(blueprint, reporting);
                request.setMaxWidth(OptionalInt.of(1536));
                request.setMaxHeight(OptionalInt.of(1536));
                request.show.pathOutputs = false;
                request.show.pathRails = false;
                request.show.gridNumbers = true;
                var result = FBSR.renderBlueprintAsync(request).get();
                if (!result.unknownEntities.isEmpty() || !result.unknownTiles.isEmpty() || !result.unknownQualities.isEmpty()) {
                    throw new IllegalStateException("Missing sprites: " + result.unknownEntities.elementSet()
                        + result.unknownTiles.elementSet() + result.unknownQualities.elementSet());
                }
                if (!reporting.getExceptions().isEmpty()) throw new IllegalStateException("Sprite rendering failed: " + reporting.getExceptions().get(0).getMessage(), reporting.getExceptions().get(0));
                if (!ImageIO.write(result.image, "PNG", Path.of(args[2]).toFile())) throw new IllegalStateException("Cannot encode PNG");
            } else {
                throw new IllegalArgumentException("Expected build or render");
            }
            System.exit(0);
        } catch (Exception failure) {
            System.err.println("FACMANDU_RENDER_ERROR: " + failure.getMessage());
            System.exit(1);
        }
    }
}
