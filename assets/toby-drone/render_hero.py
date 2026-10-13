"""Run inside Blender with toby.blend to inspect the editable animated model."""
import bpy
from pathlib import Path
root=Path(__file__).resolve().parent
scene=bpy.context.scene
scene.render.resolution_x=768;scene.render.resolution_y=768
scene.cycles.samples=64
scene.frame_set(1)
scene.render.filepath=str(root/'model-preview.png')
bpy.ops.render.render(write_still=True)
