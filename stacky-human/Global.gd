extends Node

const BEST_PATH = "user://best.save"

var speed: int = 200
var position
var pieces = 41
var score: int
var pieces_left_names: Array = []
var grid_x: float = 0.0
var perfect_streak: int = 0
var best: int = 0
var is_over = false
var over_at = 0

func _ready() -> void:
	if FileAccess.file_exists(BEST_PATH):
		var f = FileAccess.open(BEST_PATH, FileAccess.READ)
		best = f.get_32()

func reset() -> void:
	speed = 200
	position = null
	pieces = 41
	score = 0
	pieces_left_names = []
	perfect_streak = 0
	is_over = false

func game_over() -> void:
	is_over = true
	over_at = Time.get_ticks_msec()
	if score > best:
		best = score
		var f = FileAccess.open(BEST_PATH, FileAccess.WRITE)
		f.store_32(best)
