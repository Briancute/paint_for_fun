#version 300 es
precision highp float;in vec2 pos;in vec2 uv;uniform mat4 proj;uniform mat4 view;uniform mat4 model;out vec2 vUv;void main(){gl_Position=proj*view*model*vec4(pos,0.,1.);vUv=uv;}