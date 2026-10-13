"""Run with Blender --background --python build_model.py. Deterministic editable source."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
asset=bpy.data.collections.new('Toby'); scene.collection.children.link(asset)
def own(o):
    for c in list(o.users_collection): c.objects.unlink(o)
    asset.objects.link(o); return o

def material(name,color,metal=0,rough=.55):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    n=m.node_tree.nodes; p=n.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    if metal:
        tex=n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=75; tex.inputs['Detail'].default_value=2
        bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.16; bump.inputs['Distance'].default_value=.009
        m.node_tree.links.new(tex.outputs['Fac'],bump.inputs['Height']); m.node_tree.links.new(bump.outputs['Normal'],p.inputs['Normal'])
    return m
paint=material('Ochre enamel',(.38,.235,.065),.62,.42)
edge=material('Worn steel edges',(.28,.29,.27),.8,.34)
dark=material('Oiled gunmetal',(.055,.066,.066),.75,.4)
rubber=material('Rubber and cable',(.017,.021,.018),.05,.78)
rust=material('Oxidised fasteners',(.21,.09,.029),.6,.75)
black=material('Hazard black',(.029,.029,.021),.3)
screenmat=material('CRT glass',(.006,.025,.021),.25,.27)
green=material('Phosphor',(.05,.75,.39),0,.3); p=green.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(.06,.8,.35,1);p.inputs['Emission Strength'].default_value=2

def cube(name,loc,size,mat,bevel=.02,parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=own(bpy.context.object);o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(mat)
    if bevel:
        b=o.modifiers.new('Manufactured edge radius','BEVEL');b.width=bevel;b.segments=3
        o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    if parent:o.parent=parent
    return o

def cyl(name,loc,r,depth,mat,axis='Z',vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc);o=own(bpy.context.object);o.name=name;o.data.materials.append(mat)
    if axis=='X':o.rotation_euler.y=math.pi/2
    if axis=='Y':o.rotation_euler.x=math.pi/2
    b=o.modifiers.new('Machined lip','BEVEL');b.width=.012;b.segments=2;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o

def rod(name,a,b,r,mat):
    a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,(a-b).length,mat);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def hose(name,points,r=.019):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=3;s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
    for p,co in zip(s.bezier_points,points):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c);asset.objects.link(o);o.data.materials.append(rubber)

cube('Cast chassis', (0,0,.19),(.77,.64,.33),dark,.075)
cube('Armoured service deck',(0,0,.39),(.85,.68,.16),paint,.055)
cube('Battery pack rear',(0,.32,.34),(.53,.23,.3),dark,.035)
for x in (-.25,-.15,-.05,.05,.15,.25):cube('Cooling fins rear',(x,.449,.34),(.033,.034,.23),edge,.003)
cyl('Head gimbal',(0,-.015,.52),.105,.21,edge)
cyl('Gimbal swivel',(0,-.04,.57),.13,.24,dark,'X')
head=bpy.data.objects.new('CRT head tilt',None);asset.objects.link(head);head.location=(0,-.085,.86);head.rotation_euler.x=math.radians(-12)
cube('CRT cast back',(0,.07,0),(.68,.44,.5),dark,.075,head)
cube('CRT ochre housing',(0,-.025,0),(.75,.36,.55),paint,.05,head)
cube('Steel screen bezel',(0,-.219,0),(.68,.072,.465),edge,.033,head)
cube('Recessed gasket',(0,-.260,0),(.603,.025,.397),rubber,.025,head)
cube('Convex dark glass',(0,-.275,0),(.554,.018,.349),screenmat,.025,head)
# Recessed roof service plate, exposed seams and restrained enamel wear.
cube('Roof service plate',(0,.025,.283),(.47,.23,.022),dark,.013,head)
for x in (-.18,.18):
    for y in (-.05,.1):
        o=cyl('Roof screw',(x,y,.3),.012,.007,edge,vertices=6);o.parent=head
for x in (-.1,-.05,0,.05,.1):cube('Roof ventilation',(x,.02,.299),(.018,.13,.009),black,.002,head)
for x,z,width in [(-.29,.25,.09),(.27,.24,.07),(-.34,-.17,.045),(.32,-.23,.07)]:
    cube('Chipped head enamel',(x,-.209,z),(width,.013,.022),edge,.003,head)
    cube('Oxide at chip',(x+.011,-.217,z-.01),(width*.55,.008,.009),rust,.002,head)
# Front display rectangle is separately projected by finish.py; the glass stays authored.
screen_corners=[(-.259,-.287,.155),(.259,-.287,.155),(.259,-.287,-.155),(-.259,-.287,-.155)]
# Packed display texture and keyed UV offsets make every expression editable in Blender.
screen_plane=None
if (ROOT/'screen-source.png').exists():
    mesh=bpy.data.meshes.new('CRT display surface');mesh.from_pydata(screen_corners,[],[(0,1,2,3)]);mesh.update()
    screen_plane=bpy.data.objects.new('Animated CRT phosphor',mesh);asset.objects.link(screen_plane);screen_plane.parent=head
    uv=mesh.uv_layers.new(name='Display UV')
    for loop,co in zip(uv.data,[(0,1),(1,1),(1,0),(0,0)]):loop.uv=co
    m=bpy.data.materials.new('Animated state display');m.use_nodes=True;n=m.node_tree.nodes;n.clear()
    out=n.new('ShaderNodeOutputMaterial');emit=n.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=.75
    tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'screen-source.png'));tex.image.pack();tex.interpolation='Linear';tex.extension='EXTEND'
    coords=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(1/8,1/7,1)
    m.node_tree.links.new(coords.outputs['UV'],mapping.inputs['Vector']);m.node_tree.links.new(mapping.outputs['Vector'],tex.inputs['Vector']);m.node_tree.links.new(tex.outputs['Color'],emit.inputs['Color']);m.node_tree.links.new(emit.outputs[0],out.inputs[0]);mesh.materials.append(m)
    for state_index,state in enumerate(('idle','inspecting','thinking','working','speaking','success','error')):
        scene.timeline_markers.new(state,frame=state_index*8+1)
        for f in range(8):
            mapping.inputs['Location'].default_value=(f/8,(6-state_index)/7,0);mapping.inputs['Location'].keyframe_insert('default_value',frame=state_index*8+f+1)
    for fc in m.node_tree.animation_data.action.layers[0].strips[0].channelbags[0].fcurves:
        for key in fc.keyframe_points:key.interpolation='CONSTANT'
    scene.frame_end=56;scene.frame_set(1)
for x in (-.309,.309):
    for z in (-.196,.196):
        o=cyl('Bezel screw',(x,-.265,z),.019,.012,dark,'Y',16);o.parent=head
for x in (-.36,.36):
    o=cyl('Head hinge',(x,.05,0),.086,.062,edge,'X');o.parent=head
    for z in (-.12,-.06,0,.06,.12):cube('Side head vent',(x*1.018,.083,z),(.014,.15,.027),black,.004,head)
# Asymmetric sensor stalk and wired service hardware.
rod('Antenna',(.255,.125,1.105),(.29,.16,1.35),.012,edge)
cyl('Antenna collar',(.255,.125,1.11),.036,.065,dark)
cube('Antenna receiver',(.29,.16,1.35),(.055,.045,.065),dark,.016)
hose('Gimbal cable',[(-.19,.13,.88),(-.25,.25,.73),(-.19,.26,.51),(0,.18,.42)],.023)
# Paired duct housings, exposed fan hubs and fixed counter-rotating blades.
for side in (-1,1):
    x=side*.58
    rod('Outrigger',(side*.31,0,.26),(x,0,.24),.09,dark)
    cyl('Lift duct',(x,0,.28),.205,.28,paint)
    cyl('Lift duct lower rim',(x,0,.135),.211,.045,edge)
    cyl('Lift intake',(x,0,.43),.169,.02,rubber)
    cyl('Fan hub',(x,0,.456),.043,.04,edge)
    for i in range(6):
        a=i*math.tau/6;o=cube('Fan blade',(x+math.cos(a)*.094,math.sin(a)*.094,.449),(.13,.036,.012),dark,.004);o.rotation_euler.z=a+.2
    for dx in (-.13,.13):rod('Intake guard',(x+dx,-.125,.465),(x+dx,.125,.465),.009,edge)
    for i in range(3):
        o=cube('Hazard stripe',(x+(i-1)*.064,-.19,.28),(.033,.018,.18),black,.002);o.rotation_euler.y=-.3
    # Stowed tool arms retain useful silhouette at all headings.
    a=(side*.33,-.23,.31);b=(side*.47,-.40,.13);c=(side*.30,-.54,.03)
    rod('Arm piston',a,b,.038,edge);rod('Tool forearm',b,c,.043,dark)
    cyl('Arm elbow',b,.06,.095,paint,'X')
    for offset in (-.035,.035):rod('Gripper finger',(c[0]+offset,c[1],c[2]),(c[0]+offset,c[1]-.085,c[2]-.025),.015,edge)
    hose('Arm hydraulic line',[(side*.27,-.1,.28),(side*.49,-.22,.24),(side*.48,-.4,.11)],.012)
    for y in (-.23,.23):cyl('Deck bolt',(side*.33,y,.48),.023,.019,edge,vertices=6)
# Small deliberately placed chips, seams and latch catches, no randomized surface noise.
for x,y in [(-.31,-.28),(.19,-.29),(.34,.20),(-.28,.19)]:cube('Paint chip',(x,y,.477),(.053,.018,.004),edge,.002)
cube('Front service latch',(0,-.338,.29),(.13,.035,.12),edge,.01)
for x in (-.245,.245):cube('Front panel seam',(x,-.331,.30),(.014,.01,.13),black,.001)
# All geometry remains separate and editable; one root supplies the turntable.
root=bpy.data.objects.new('Toby orientation',None);scene.collection.objects.link(root)
for o in list(asset.objects):
    if o.parent is None:o.parent=root
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=128;scene.render.resolution_y=128;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
world=bpy.data.worlds.new('Factory ambient');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.38,.43,.5,1);world.node_tree.nodes['Background'].inputs[1].default_value=.55
bpy.ops.object.camera_add(location=(0,-7,10));cam=bpy.context.object;cam.name='Factorio orthographic';target=Vector((0,0,.48));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2;scene.camera=cam
bpy.ops.object.light_add(type='AREA',location=(-3,4,8));light=bpy.context.object;light.name='Northwest soft sun';light.data.energy=950;light.data.shape='DISK';light.data.size=3;light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
scene['asset_notes']='Toby: 1.58 tile wide industrial companion. Forward -Y. 16 clockwise directions from north. Screen state compositing is reproducible from screen_corners.json.'
scene.render.fps=12
bpy.context.view_layer.update()
root.rotation_euler.z=0
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'toby.blend'))
if screen_plane:screen_plane.hide_render=True
raw=ROOT/'renders';raw.mkdir(exist_ok=True)
views=[]
for i in range(16):
    root.rotation_euler.z=math.pi-i*math.tau/16;bpy.context.view_layer.update()
    corners=[]
    for co in screen_corners:
        p=world_to_camera_view(scene,cam,head.matrix_world@Vector(co));corners.append([p.x*128,(1-p.y)*128])
    normal=head.matrix_world.to_3x3()@Vector((0,-1,0));visible=normal.dot((cam.location-head.matrix_world.translation).normalized())>.12
    views.append({'direction':i,'corners':corners,'screen_visible':visible})
    scene.render.filepath=str(raw/f'body-{i:02}.png');bpy.ops.render.render(write_still=True)
(ROOT/'screen_corners.json').write_text(json.dumps(views,indent=2)+'\n')
# Project the evaluated source geometry along the fixed sun onto ground for shadows.
root.rotation_euler.z=0;bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
shadow_collection=bpy.data.collections.new('Projected shadows');scene.collection.children.link(shadow_collection)
for o in list(asset.objects):
    if o.type not in {'MESH','CURVE'} or o==screen_plane:continue
    ev=o.evaluated_get(deps);mesh=bpy.data.meshes.new_from_object(ev);obj=bpy.data.objects.new(o.name+' shadow',mesh);shadow_collection.objects.link(obj)
    for v in mesh.vertices:v.co=o.matrix_world@v.co
asset.hide_render=True
shadowmat=bpy.data.materials.new('Shadow silhouette');shadowmat.use_nodes=True;n=shadowmat.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');e=n.new('ShaderNodeEmission');e.inputs['Color'].default_value=(0,0,0,1);shadowmat.node_tree.links.new(e.outputs[0],out.inputs[0])
original={o.name:[v.co.copy() for v in o.data.vertices] for o in shadow_collection.objects}
cam.location=(.25,-7.2,10);cam.rotation_euler=(Vector((.25,-.2,0))-cam.location).to_track_quat('-Z','Y').to_euler()
for i in range(16):
    a=math.pi-i*math.tau/16;c,s=math.cos(a),math.sin(a)
    for o in shadow_collection.objects:
        o.data.materials.clear();o.data.materials.append(shadowmat)
        for v,p in zip(o.data.vertices,original[o.name]):
            x,y=c*p.x-s*p.y,s*p.x+c*p.y
            v.co=(x+.375*(p.z+.3),y-.5*(p.z+.3),0)
    scene.render.filepath=str(raw/f'shadow-{i:02}.png');bpy.ops.render.render(write_still=True)
print('TOBY_RENDER_COMPLETE')
