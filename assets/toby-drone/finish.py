# /// script
# dependencies = ["Pillow>=12", "numpy"]
# ///
"""Build state animations and Factorio atlases from physically lit Blender renders."""
from pathlib import Path
import json, math, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
ROOT=Path(__file__).resolve().parent
STATES=('idle','inspecting','thinking','working','speaking','success','error')
SIZE=128;FRAMES=8
OUT=ROOT/'sprites';OUT.mkdir(exist_ok=True)
views=json.loads((ROOT/'screen_corners.json').read_text())

def face(state,frame):
    im=Image.new('RGBA',(128,80),(3,17,14,255));d=ImageDraw.Draw(im)
    color=(116,240,171,255); dim=(23,76,53,255)
    if state=='error':color=(255,112,57,255)
    if state=='success':color=(144,255,164,255)
    # Curved CRT glass, dark margin and subtle horizontal raster lines.
    d.rounded_rectangle((2,2,125,77),10,outline=(29,66,50,255),width=2)
    if state=='idle':
        # Uneven eyes and a crooked, single-toothed grin stay legible at game scale.
        for x,y,r in ((36,31,17),(91,27,13)):
            if frame==6:d.line((x-r,y,x+r,y),fill=color,width=5)
            else:
                d.ellipse((x-r,y-r,x+r,y+r),fill=color)
                gaze=3 if frame in (2,3,4) else -2
                d.ellipse((x+gaze-5,y-4,x+gaze+5,y+6),fill=(2,19,12,255))
        d.line([(43,57),(62,65),(88,55)],fill=color,width=5)
        d.rectangle((61,58,69,65),fill=color)
    elif state=='inspecting':
        x=42+int(8*math.sin(frame*math.tau/8))
        d.ellipse((x-25,10,x+25,59),outline=color,width=5)
        d.ellipse((x-13,22,x+13,48),fill=color)
        d.ellipse((x-4+frame%3,29,x+5+frame%3,40),fill=(2,19,12,255))
        d.line((x+19,53,x+34,69),fill=color,width=6)
        d.line((87,28,109,22),fill=color,width=5)
        d.line((83,59,105,55),fill=color,width=3)
        y=12+frame*7;d.line((14,y,113,y),fill=(49,153,99,255),width=1)
    elif state=='thinking':
        d.ellipse((20,14,46,40),outline=color,width=4)
        d.ellipse((75,10,107,42),outline=color,width=4)
        d.ellipse((29+frame%3,22,37+frame%3,31),fill=color)
        d.ellipse((87,19+frame%3,96,28+frame%3),fill=color)
        points=[(22,63),(22,51),(49,51),(49,64),(77,64),(77,50),(103,50)]
        d.line(points[:min(7,2+frame)],fill=color,width=3)
        for x,y in points[:min(7,2+frame)]:d.rectangle((x-2,y-2,x+2,y+2),fill=color)
    elif state=='working':
        d.line((20,19,49,29),fill=color,width=6);d.line((80,29,108,19),fill=color,width=6)
        d.rectangle((32,43,97,66),outline=color,width=4)
        for x in (45,59,73,87):d.line((x,44,x,65),fill=color,width=3)
        # Straining expression with an animated falling coolant/sweat droplet.
        y=29+frame*4;d.ellipse((111,y,118,y+9),fill=color)
    elif state=='speaking':
        d.ellipse((25,15,43,32),fill=color);d.ellipse((84,15,102,32),fill=color)
        h=10+int(22*(.5+.5*math.sin(frame*1.6)))
        d.ellipse((46,55-h/2,84,55+h/2),fill=color)
        d.ellipse((53,56-h/3,77,56+h/3),fill=(2,19,12,255))
    elif state=='success':
        d.line([(19,31),(33,18),(47,31)],fill=color,width=5)
        d.line([(79,31),(94,18),(109,31)],fill=color,width=5)
        d.arc((35,29,96,71),0,180,fill=color,width=6)
        for x in (17,108):
            d.line((x,44,x+5,50),fill=color,width=3)
            if frame%4<2:d.line((x+5,41,x+10,47),fill=color,width=3)
    else:
        for x in (35,93):
            d.line((x-12,17,x+12,39),fill=color,width=6)
            d.line((x+12,17,x-12,39),fill=color,width=6)
        d.line([(29,62),(42,53),(55,63),(68,53),(81,63),(95,53)],fill=color,width=4)
        if frame%4<2:
            d.rectangle((8,9,12,70),fill=color);d.rectangle((115,9,119,70),fill=color)
    raster=Image.new('RGBA',im.size);scan=ImageDraw.Draw(raster)
    for y in range(4,78,4):scan.line((5,y,122,y),fill=(0,0,0,35),width=1)
    im=Image.alpha_composite(im,raster)
    # Alpha represents the glass surface; raster darkness must not expose an unlit hole.
    im.putalpha(255)
    return im

def projected_face(display,corners):
    # Solve destination-to-source projective map from the 3D-authored glass corners.
    target=[(0,0),(127,0),(127,79),(0,79)];rows=[];rhs=[]
    for (x,y),(u,v) in zip(corners,target):
        rows.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);rhs.extend([u,v])
    coeff=np.linalg.solve(np.array(rows),np.array(rhs))
    return display.transform((SIZE,SIZE),Image.Transform.PERSPECTIVE,coeff,Image.Resampling.BICUBIC)

screen_source=Image.new('RGBA',(1024,560))
for row,state in enumerate(STATES):
    for f in range(8):screen_source.paste(face(state,f),(f*128,row*80))
screen_source.save(ROOT/'screen-source.png')
bodies=[Image.open(ROOT/'renders'/f'body-{i:02}.png').convert('RGBA') for i in range(16)]
shadows=[]
for i in range(16):
    src=Image.open(ROOT/'renders'/f'shadow-{i:02}.png').convert('RGBA');a=src.getchannel('A').filter(ImageFilter.GaussianBlur(.65)).point(lambda x:round(x*.34));im=Image.new('RGBA',src.size);im.putalpha(a);shadows.append(im)
shadow=Image.new('RGBA',(128,2048))
for i,im in enumerate(shadows):shadow.paste(im,(0,i*128))
shadow.save(OUT/'shadow.png')
frames_by_state={}
for state in STATES:
    atlas=Image.new('RGBA',(1024,2048));frames=[]
    for direction in range(16):
        for f in range(FRAMES):
            im=bodies[direction].copy()
            if views[direction]['screen_visible']:
                display=projected_face(face(state,f),views[direction]['corners']);im=Image.alpha_composite(im,display)
            atlas.paste(im,(f*128,direction*128))
            if direction==8:frames.append(im)
    atlas.save(OUT/f'{state}.png');frames_by_state[state]=frames
# Native and 4x previews with every heading and every state. Background is preview only.
contact=Image.new('RGB',(16*128,8*152),(43,44,37));d=ImageDraw.Draw(contact)
for direction,body in enumerate(bodies):
    im=body.copy()
    if views[direction]['screen_visible']:im=Image.alpha_composite(im,projected_face(face('idle',0),views[direction]['corners']))
    contact.paste(im,(direction*128,16),im);d.text((direction*128+5,2),str(direction),fill='white')
for row,state in enumerate(STATES,1):
    d.text((5,row*152),state,fill='white')
    for f,im in enumerate(frames_by_state[state]):contact.paste(im,(f*128,row*152+18),im)
contact.save(ROOT/'native-preview.png')
expressions=Image.new('RGB',(512,296),(43,44,37));labels=ImageDraw.Draw(expressions)
for index,state in enumerate(STATES):
    x=(index%4)*128;y=(index//4)*148
    labels.text((x+5,y+3),state,fill='white')
    frame=frames_by_state[state][2]
    expressions.paste(frame,(x,y+18),frame)
expressions.save(ROOT/'expressions-native.png')
expressions.resize((2048,1184),Image.Resampling.NEAREST).save(ROOT/'expressions-4x.png')
hero=Image.new('RGBA',(128,128));hero=Image.alpha_composite(hero,frames_by_state['idle'][0]);hero.save(ROOT/'native-south.png');hero.resize((512,512),Image.Resampling.NEAREST).save(ROOT/'preview-4x.png')
hero.resize((64,64),Image.Resampling.LANCZOS).save(OUT/'icon.png')
anims=[]
for state in STATES:
    for im in frames_by_state[state]:
        bg=Image.new('RGB',(384,420),(43,44,37));bg.paste(im.resize((384,384),Image.Resampling.NEAREST),(0,30),im.resize((384,384),Image.Resampling.NEAREST));ImageDraw.Draw(bg).text((12,10),state,fill='white');anims.append(bg)
anims[0].save(ROOT/'states.gif',save_all=True,append_images=anims[1:],duration=125,loop=0,disposal=2)
manifest={'cell':[128,128],'scale':0.5,'pixels_per_tile':64,'frame_count':8,'line_length':8,'direction_count':16,'direction_order':'north, clockwise in 22.5 degree steps','atlas_layout':'frames across columns, directions down rows','shift':[0,-0.28428],'shadow_shift':[0.25,0.16385],'shadow':{'file':'sprites/shadow.png','cell':[128,128],'frame_count':1,'line_length':1,'direction_count':16,'draw_as_shadow':True},'states':{s:{'file':f'sprites/{s}.png','fps':8 if s=='idle' else 12,'loop':True} for s in STATES},'source':'toby.blend','screen_visibility':'Physical screen is occluded in rear views; front states are visible in directions 4 through 12, clearest in 5 through 11.','render':{'engine':'Cycles','samples':32,'camera':'physical orthographic','orthographic_span_tiles':2,'transparent':True,'light':'fixed northwest area light','shadow':'evaluated model projected along northwest sun, softened .65 px'},'files':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.glob('*.png'))}}
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Wrote seven 1024x2048 atlases, 128x2048 shadow, icon and previews.')

# Validate shipped cells rather than relying only on successful rendering.
checked=0
for state in STATES:
    atlas=Image.open(OUT/f'{state}.png')
    assert atlas.size==(1024,2048), state
    for direction in range(16):
        for f in range(FRAMES):
            cell=atlas.crop((f*128,direction*128,(f+1)*128,(direction+1)*128))
            bounds=cell.getchannel('A').getbbox()
            assert bounds and min(bounds[:2])>=2 and max(bounds[2:])<=126,(state,direction,f,bounds)
            checked+=1
    assert len({im.tobytes() for im in frames_by_state[state]})>1,state
for direction,cell in enumerate(shadows):
    bounds=cell.getchannel('A').point(lambda a:255 if a>2 else 0).getbbox()
    assert bounds and min(bounds[:2])>=2 and max(bounds[2:])<=126,('shadow',direction,bounds)
report={'passed':True,'state_cells':checked,'shadow_cells':16,'margin_px':2,'all_front_states_animate':True,'live_game_integration':'not tested by asset build'}
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
