extends Node2D

var block = preload("res://block.tscn")
var start_position = Vector2(544, 488)
var current_block
var next_side = "left"

func _ready() -> void:
	current_block = $RigidBody2D
	$Camera2D.position = current_block.position

func _process(_delta: float) -> void:
	if Input.is_action_just_pressed("lmb"):spawn_new_block()
	if is_instance_valid(current_block):
		$Camera2D.position.y = current_block.global_position.y

func spawn_new_block():
	var a = block.instantiate()
	Global.position.y = Global.position.y - 20
	a.position = Global.position
	a.spawn_side = next_side
	if next_side == "left":
		next_side = "right"
	else:
		next_side = "left"
	add_child(a)
	current_block = a
