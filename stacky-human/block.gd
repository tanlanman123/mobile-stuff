extends RigidBody2D

var speed = Global.speed
var slide_range: float = 250.0
var start_x: float
var direction: float = 1.0
var already_clicked = false
var spawn_side = ""

func _ready() -> void:
	# Blocks only move from code; frozen so contacts can't nudge or tilt them
	freeze_mode = RigidBody2D.FREEZE_MODE_KINEMATIC
	freeze = true
	start_x = position.x
	if spawn_side == "":
		Global.grid_x = position.x
	if spawn_side == "left":
		position.x = start_x - slide_range
		direction = 1.0
	elif spawn_side == "right":
		position.x = start_x + slide_range
		direction = -1.0
	for i in range(1, 41):
		if spawn_side != "" and Global.pieces_left_names.size() > 0 and not i in Global.pieces_left_names:
			var piece = get_node(str(i))
			remove_child(piece)
			piece.queue_free()
			continue
		var ray: RayCast2D = get_node(str(i) + "/RayCast2D")
		ray.add_exception(self)
		ray.position.y = 5
		ray.target_position = Vector2(0, 15)
	

func _physics_process(delta: float) -> void:
	if !already_clicked == true:
		position.x += speed * direction * delta
		if position.x > start_x + slide_range:
			position.x = start_x + slide_range
			direction = -1.0
		elif position.x < start_x - slide_range:
			position.x = start_x - slide_range
			direction = 1.0

func _unhandled_input(event: InputEvent) -> void:
	if already_clicked:
		return
	if event.is_action_pressed("lmb"):
		already_clicked = true
		position.x = Global.grid_x + snappedf(position.x - Global.grid_x, 5.0)
		Global.speed = speed + 10
		Global.position = global_position
		Check_rebublic()
		

func Check_rebublic() -> void:
	var pieces_left = 0
	var destroyed = 0
	var names = []
	for i in range(1, 41):
		var piece := get_node_or_null(str(i))
		if piece == null:
			continue
		var ray: RayCast2D = piece.get_node("RayCast2D")
		ray.force_raycast_update()
		if ray.is_colliding():
			pieces_left += 1
			names.append(i)
		else:
			destroyed += 1
	if pieces_left == 0:
		# Total miss: the whole block drops off the screen
		var fall = create_tween()
		fall.tween_property(self, "position:y", position.y + 600, 0.8).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
		Global.game_over()
		return
	for i in range(1, 41):
		if not i in names and has_node(str(i)):
			get_node(str(i)).queue_free()
	Global.score += 1
	if destroyed == 0:
		Global.perfect_streak += 1
	else:
		Global.perfect_streak = 0
	if Global.perfect_streak == 3:
		Global.perfect_streak = 0
		names = grow(names, 2)
		pieces_left = names.size()
	Global.pieces = pieces_left
	Global.pieces_left_names = names

func grow(names: Array, amount: int) -> Array:
	var template = get_node(str(names[0]))
	var add_right = true
	while amount > 0:
		var n
		if add_right and names.max() < 40:
			n = names.max() + 1
		elif names.min() > 1:
			n = names.min() - 1
		elif names.max() < 40:
			n = names.max() + 1
		else:
			break
		var piece = template.duplicate()
		piece.name = str(n)
		piece.position.x = -97 + 5 * (n - 1)
		add_child(piece)
		names.append(n)
		amount -= 1
		add_right = !add_right
	names.sort()
	return names
