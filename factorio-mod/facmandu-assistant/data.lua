require('planner.data')
require('drone-prototypes')
data:extend{
 {type='sprite',name='toby-launcher',filename='__facmandu-assistant__/graphics/icon.png',width=64,height=64},
 {type='shortcut',name='facmandu-toby-open',action='lua',associated_control_input='facmandu-toby-toggle',
  icon='__facmandu-assistant__/graphics/icon.png',icon_size=64,small_icon='__facmandu-assistant__/graphics/icon.png',small_icon_size=64,order='toby-a'}
}
data:extend{
 {type='custom-input',name='facmandu-toby-toggle',key_sequence='CONTROL + SHIFT + T',consuming='none'},
 {type='custom-input',name='facmandu-toby-design',key_sequence='CONTROL + SHIFT + B',consuming='none'},
 {type='custom-input',name='facmandu-toby-claim-drone',key_sequence='CONTROL + SHIFT + Y',consuming='none'},
 {type='custom-input',name='facmandu-toby-open-drone',key_sequence='CONTROL + SHIFT + D',consuming='none'}
}
