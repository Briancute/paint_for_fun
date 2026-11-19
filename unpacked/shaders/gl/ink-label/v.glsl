#version 300 es
precision highp float;uniform vec4 rect;in vec2 pos;in vec2 uv;out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(rect.xy+(pos*.5+.5)*rect.zw,0.,1.);}