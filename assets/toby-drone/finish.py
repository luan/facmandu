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
        for x in (40,88):
            height=3 if frame==6 else 15
            d.rounded_rectangle((x-8,34-height/2,x+8,34+height/2),3,fill=color)
        d.line([(51,53),(64,57),(77,53)],fill=color,width=3)
    elif state=='inspecting':
        x=43+int(20*math.sin(frame*math.tau/8));d.ellipse((x-19,17,x+19,55),outline=color,width=4);d.line((x+14,51,x+30,67),fill=color,width=5)
        d.line((x-9,36,x+9,36),fill=color,width=2);d.line((x,27,x,45),fill=color,width=2)
        y=12+frame*7;d.line((13,y,115,y),fill=(49,153,99,255),width=2)
    elif state=='thinking':
        for x in range(20,110,20):d.line((x,13,x,65),fill=dim,width=1)
        for y in range(16,70,16):d.line((16,y,112,y),fill=dim,width=1)
        points=[(27,56),(27,28),(55,28),(55,48),(85,48),(85,22),(104,22)]
        d.line(points[:min(7,2+frame)],fill=color,width=3)
        for x,y in points[:min(7,2+frame)]:d.rectangle((x-3,y-3,x+3,y+3),fill=color)
        for k in range(3):d.ellipse((52+k*12,67,57+k*12,72),fill=color if k==frame%3 else dim)
    elif state=='working':
        d.line((36,20,77,59),fill=color,width=9);d.arc((23,9,52,38),30,285,fill=color,width=7);d.ellipse((68,49,86,67),outline=color,width=4)
        for k in range(4):
            x=93; y=17+k*13;d.rectangle((x,y,x+13,y+7),fill=color if k<=frame%4 else dim)
    elif state=='speaking':
        for k in range(9):
            h=8+int(29*(.5+.5*math.sin(frame*1.6+k*.9)))
            x=21+k*11;d.rounded_rectangle((x,40-h/2,x+5,40+h/2),2,fill=color)
    elif state=='success':
        d.line([(31,40),(53,59),(96,19)],fill=color,width=9)
        if frame<4:d.arc((17,5,112,75),frame*20,230+frame*20,fill=dim,width=2)
    else:
        d.line([(64,11),(102,65),(26,65),(64,11)],fill=color,width=4)
        d.rectangle((61,30,67,46),fill=color);d.rectangle((61,52,67,58),fill=color)
        if frame%4<2:d.rectangle((8,8,12,71),fill=color);d.rectangle((115,8,119,71),fill=color)
    for y in range(4,78,4):d.line((5,y,122,y),fill=(0,0,0,35),width=1)
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
