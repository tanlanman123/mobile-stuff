extends Control

var over_bg: ColorRect
var over_box: VBoxContainer
var over_score: Label
var over_best: Label

func _ready() -> void:
	# Fill the screen so the score stays centered on any phone size
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	$Label.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	$Label.offset_top = 40
	$Label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER

	over_bg = ColorRect.new()
	over_bg.color = Color(0, 0, 0, 0.5)
	over_bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	over_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	over_bg.visible = false
	add_child(over_bg)
	over_box = VBoxContainer.new()
	over_box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	over_box.alignment = BoxContainer.ALIGNMENT_CENTER
	over_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	over_bg.add_child(over_box)
	make_label("Game over", 72)
	over_score = make_label("", 48)
	over_best = make_label("", 40)
	make_label("Tap to play again", 32)

func make_label(text: String, size: int) -> Label:
	var l = Label.new()
	l.text = text
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_constant_override("outline_size", 12)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	over_box.add_child(l)
	return l

func _process(_delta: float) -> void:
	$Label.text = str(Global.score)
	$Label.visible = not Global.is_over
	if Global.is_over and not over_bg.visible:
		over_score.text = "Score " + str(Global.score)
		over_best.text = "Best " + str(Global.best)
		over_bg.visible = true
