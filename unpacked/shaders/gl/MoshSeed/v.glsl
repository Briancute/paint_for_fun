#version 300 es
precision highp float;in vec2 pos;in vec2 uv;uniform vec2 center;uniform vec2 ext;out vec2 vUv;void main(){vUv=uv;gl_Position=vec4((center*2.-1.)+pos*ext*2.,0.,1.);}