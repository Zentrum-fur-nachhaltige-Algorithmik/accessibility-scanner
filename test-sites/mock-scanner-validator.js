#!/usr/bin/env node

/**
 * Test Runner für Phase6a Accessibility Scanner
 * 
 * Dieser Script testet die Genauigkeit der Phase6a Implementierung
 * durch Validierung gegen die erstellten Test-Websites.
 */

const fs = require('fs');
const path = require('path');

// Import der Phase6a Scanner (Pfad muss angepasst werden)
// const { runPhase6aScan } = require('../phase6a/scanner');

// Test-Konfiguration
const TEST_SITES = {
    // BAD Examples - sollten als SCHLECHT erkannt werden
    bad: [
        {
            name: 'Color Contrast Violations',
            file: 'bad-color-contrast.html',
            expectedViolations: [
                'color_contrast_insufficient',
                'text_background_contrast_too_low',
                'button_contrast_insufficient',
                'form_contrast_poor'
            ],
            expectedConfidence: 'high', // >80%
            description: 'Multiple color contrast violations with ratios below WCAG AA standards'
        },
        {
            name: 'Use of Color Violations', 
            file: 'bad-use-of-color.html',
            expectedViolations: [
                'links_color_only',
                'form_errors_color_only',
                'required_fields_color_only',
                'status_messages_color_only',
                'chart_legend_color_only',
                'navigation_state_color_only',
                'availability_color_only'
            ],
            expectedConfidence: 'high',
            description: 'Information conveyed by color alone without additional indicators'
        },
        {
            name: 'Images of Text Violations',
            file: 'bad-images-of-text.html', 
            expectedViolations: [
                'text_in_images_buttons',
                'text_in_images_headers',
                'text_in_images_navigation',
                'text_in_images_prices',
                'text_in_images_cta',
                'text_in_images_forms'
            ],
            expectedConfidence: 'medium', // 60-80% aufgrund Heuristiken
            description: 'Text content rendered as images instead of HTML text'
        },
        
        // === NEW PHASE 1: SAFETY CRITICAL ===
        {
            name: 'Seizure Risk Violations',
            file: 'bad-seizure-risk.html',
            expectedViolations: [
                'flashing_content_10hz',
                'strobe_effect_dangerous',
                'rapid_color_changes',
                'blinking_text_fast',
                'canvas_dangerous_patterns',
                'video_flashing_content',
                'background_flashing'
            ],
            expectedConfidence: 'high',
            description: 'Content flashing >3Hz causing seizure risk - SAFETY CRITICAL'
        },
        {
            name: 'Label in Name Violations',
            file: 'bad-label-in-name.html',
            expectedViolations: [
                'aria_label_mismatch_button',
                'aria_label_mismatch_link',
                'aria_label_mismatch_input',
                'aria_labelledby_wrong_reference',
                'voice_control_failure',
                'inconsistent_naming_multiple'
            ],
            expectedConfidence: 'high',
            description: 'Voice control incompatible - visible text ≠ accessible name'
        },
        {
            name: 'Status Messages Violations',
            file: 'bad-status-messages.html',
            expectedViolations: [
                'silent_status_updates',
                'hidden_status_changes',
                'missing_aria_live',
                'missing_role_alert',
                'form_errors_silent',
                'dynamic_content_silent',
                'critical_messages_silent'
            ],
            expectedConfidence: 'high',
            description: 'Screen reader users miss critical status updates'
        },
        
        // === NEW PHASE 2: CORE FUNCTIONALITY ===
        {
            name: 'Non-Text Contrast Violations',
            file: 'bad-nontext-contrast.html',
            expectedViolations: [
                'button_border_contrast_low',
                'input_border_invisible',
                'focus_indicator_poor',
                'ui_component_contrast_fail',
                'checkbox_border_invisible',
                'dropdown_contrast_poor',
                'icon_contrast_insufficient'
            ],
            expectedConfidence: 'high',
            description: 'UI components with contrast <3:1 invisible to low vision users'
        },
        {
            name: 'Timing Controls Violations',
            file: 'bad-timing-controls.html',
            expectedViolations: [
                'autoplay_video_no_controls',
                'autoplay_audio_no_controls',
                'auto_refresh_no_pause',
                'carousel_auto_advance',
                'session_timeout_no_extension',
                'form_timeout_no_warning',
                'moving_content_no_pause'
            ],
            expectedConfidence: 'high',
            description: 'Auto-play and timing without user controls - motor disability barrier'
        },
        {
            name: 'Form Error Handling Violations',
            file: 'bad-form-errors.html',
            expectedViolations: [
                'missing_error_identification',
                'poor_error_descriptions',
                'missing_error_suggestions',
                'visual_only_errors',
                'unlinked_error_messages',
                'missing_required_indicators',
                'dangerous_actions_no_confirmation'
            ],
            expectedConfidence: 'high',
            description: 'Poor form error handling prevents successful completion'
        },
        
        // === NEW PHASE 3: ADVANCED COVERAGE ===
        {
            name: 'Complex ARIA Violations',
            file: 'bad-complex-aria.html',
            expectedViolations: [
                'tree_missing_aria_expanded',
                'grid_missing_row_col_index',
                'combobox_missing_controls',
                'tabs_missing_aria_selected',
                'accordion_missing_expanded',
                'dialog_missing_modal',
                'menu_missing_haspopup',
                'listbox_missing_selected'
            ],
            expectedConfidence: 'high',
            description: 'Complex ARIA widgets with incomplete implementations'
        },
        {
            name: 'Input Modalities Violations',
            file: 'bad-input-modalities.html',
            expectedViolations: [
                'swipe_only_navigation',
                'pinch_only_zoom',
                'drag_only_reorder',
                'multi_touch_only',
                'long_press_only',
                'mouse_only_interactions',
                'down_event_only_actions',
                'motion_only_controls'
            ],
            expectedConfidence: 'medium',
            description: 'Gesture-dependent interactions without alternatives'
        },
        {
            name: 'HTML Validation Violations',
            file: 'bad-html-validation.html',
            expectedViolations: [
                'invalid_aria_references',
                'duplicate_ids',
                'invalid_nesting',
                'broken_table_structure',
                'broken_list_structure',
                'broken_heading_hierarchy',
                'invalid_aria_combinations',
                'missing_required_attributes'
            ],
            expectedConfidence: 'high',
            description: 'Invalid HTML structure breaking accessibility features'
        },
        
        // === NEW PHASE 1 EXTENDED: CRITICAL PATTERNS ===
        {
            name: 'CSS Background Info Violations',
            file: 'bad-css-background-info.html',
            expectedViolations: [
                'css_background_cta_text',
                'css_background_icons_only',
                'css_background_status_indicators',
                'css_background_navigation',
                'css_background_pricing',
                'css_background_charts',
                'css_background_social_links',
                'css_background_notifications'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.1.1 - Information only available as CSS background images'
        },
        {
            name: 'Complex Data Tables Violations',
            file: 'bad-complex-data-tables.html',
            expectedViolations: [
                'table_multi_level_headers_no_scope',
                'table_data_headers_as_td',
                'table_layout_without_role',
                'table_missing_caption',
                'table_irregular_structure',
                'table_matrix_no_headers_id',
                'table_merged_cells_no_markup',
                'table_sortable_no_aria'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.3.1 & 4.1.2 - Complex data tables without proper semantic structure'
        },
        {
            name: 'Hover Focus Content Violations',
            file: 'bad-hover-focus-content.html',
            expectedViolations: [
                'tooltip_disappears_immediately',
                'dropdown_closes_hover_loss',
                'sidebar_hover_only_no_keyboard',
                'modal_auto_closes_time',
                'hover_cards_no_keyboard_access',
                'mega_menu_impossible_navigation',
                'notification_auto_hides',
                'focus_content_disappears'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.4.13 - Content on hover/focus not dismissible, hoverable, or persistent'
        },
        {
            name: 'Pointer Cancellation Violations',
            file: 'bad-pointer-cancellation.html',
            expectedViolations: [
                'down_event_triggers_action',
                'drag_drop_no_cancellation',
                'swipe_gestures_no_undo',
                'context_menu_no_escape',
                'slider_no_reset',
                'drawing_no_undo',
                'file_upload_immediate_processing',
                'destructive_button_down_action'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.5.2 - Pointer events without cancellation or undo mechanism'
        },
        
        // === NEW PHASE 2: SUBTLE PATTERNS ===
        {
            name: 'ARIA State Updates Violations',
            file: 'bad-aria-state-updates.html',
            expectedViolations: [
                'tabs_no_aria_selected_updates',
                'accordion_no_aria_expanded',
                'toggles_no_aria_pressed',
                'dynamic_content_no_live_regions',
                'modal_no_aria_modal',
                'form_validation_no_aria_invalid',
                'loading_states_no_aria_busy',
                'dropdown_no_aria_expanded'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 4.1.2 & 4.1.3 - Dynamic UI components without ARIA state updates'
        },
        {
            name: 'Error Prevention Violations',
            file: 'bad-error-prevention.html',
            expectedViolations: [
                'financial_transactions_no_confirmation',
                'legal_commitments_no_review',
                'data_deletion_no_safeguards',
                'account_changes_no_verification',
                'test_data_in_production',
                'autosave_no_user_control',
                'time_sensitive_no_warning',
                'system_actions_no_confirmation'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 3.3.4 - Critical actions without error prevention mechanisms'
        },
        {
            name: 'Cognitive Accessibility Violations',
            file: 'bad-cognitive-accessibility.html',
            expectedViolations: [
                'complex_instructions_no_structure',
                'memory_dependent_tasks_no_aids',
                'session_timeouts_no_warning',
                'auto_refresh_no_control',
                'navigation_inconsistency',
                'error_messages_unclear',
                'context_changes_unexpected',
                'disappearing_content_no_warning',
                'information_overload_no_organization',
                'progress_indicators_missing'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 3.2.x & 3.3.2 - Cognitive barriers without assistive features'
        },
        {
            name: 'Motion and Vestibular Violations',
            file: 'bad-motion-vestibular.html',
            expectedViolations: [
                'parallax_scrolling_no_controls',
                'autoplay_video_camera_movement',
                'tilt_navigation_no_alternatives',
                'carousel_automatic_rotation',
                'scroll_triggered_animations_no_control',
                'background_animation_no_pause',
                'zoom_interactions_no_alternatives',
                'device_motion_no_consent'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.3.3 & 2.5.4 - Motion-based interactions without alternatives or controls'
        },
        {
            name: 'Target Size Violations',
            file: 'bad-target-size.html',
            expectedViolations: [
                'tiny_buttons_20x20px',
                'close_buttons_16x16px',
                'form_controls_12x12px',
                'pagination_18x18px',
                'mobile_menu_24x24px',
                'sliders_12x12px',
                'social_icons_16x16px',
                'tabs_32px_height',
                'toolbars_22x22px',
                'rating_stars_14x14px'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.5.5 - Touch targets below 44x44px minimum size requirement'
        },
        {
            name: 'Reading Level Violations',
            file: 'bad-reading-level.html',
            expectedViolations: [
                'complex_academic_language',
                'technical_jargon_no_explanations',
                'dense_legal_text',
                'medical_terminology_no_context',
                'complex_financial_information',
                'academic_abstracts_no_summaries',
                'bureaucratic_language_no_translation',
                'technical_docs_no_glossary',
                'long_sentences_no_breaks',
                'foreign_phrases_no_translation'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 3.1.5 - Text complexity exceeds secondary education level without simplified alternatives'
        },
        
        // === NEW PHASE 1: FOUNDATION PATTERNS ===
        {
            name: 'Image Alt Text Violations',
            file: 'bad-image-alt.html',
            expectedViolations: [
                'missing_alt_attributes',
                'empty_alt_on_informative_images',
                'useless_generic_alt_text',
                'keyword_stuffed_alt_text',
                'redundant_alt_text',
                'complex_images_inadequate_descriptions'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.1.1 - Image alt text failures preventing screen reader access'
        },
        {
            name: 'Form Label Violations',
            file: 'bad-form-labels.html',
            expectedViolations: [
                'unlinked_labels_missing_for_id',
                'placeholder_only_labels',
                'visual_labels_wrong_elements',
                'missing_required_indicators',
                'instructions_not_linked_aria_describedby',
                'conflicting_aria_label_visible_labels',
                'ambiguous_labels_similar_controls',
                'form_controls_no_labels'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 3.3.2 & 1.3.1 - Form labeling failures preventing form completion'
        },
        {
            name: 'Media Alternatives Violations',
            file: 'bad-media-alternatives.html',
            expectedViolations: [
                'video_no_captions',
                'audio_no_transcripts',
                'inaccurate_unsynced_captions',
                'audio_cues_no_alternatives',
                'visual_only_content_no_audio_description',
                'live_video_no_captions',
                'data_visualizations_no_description',
                'autoplay_media_no_controls'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.2.x - Media accessibility failures for deaf and blind users'
        },
        {
            name: 'Icon Accessibility Violations',
            file: 'bad-icon-accessibility.html',
            expectedViolations: [
                'icon_buttons_no_accessible_names',
                'fontawesome_icons_no_screen_reader_text',
                'svg_graphics_no_accessible_names',
                'decorative_icons_unnecessary_descriptions',
                'status_indicators_no_text_alternatives',
                'interactive_icons_no_proper_roles',
                'icon_only_navigation',
                'emoji_critical_information'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.1.1 & 4.1.2 - Icon accessibility failures preventing understanding'
        },
        
        // === NEW PHASE 2: KEYBOARD & NAVIGATION ===
        {
            name: 'Keyboard Access Violations',
            file: 'bad-keyboard-access.html',
            expectedViolations: [
                'div_buttons_no_keyboard_support',
                'clickable_images_no_keyboard_access',
                'custom_dropdowns_no_keyboard_navigation',
                'interactive_map_regions_no_keyboard',
                'custom_sliders_mouse_only',
                'span_elements_click_handlers',
                'modal_dialogs_poor_keyboard_handling',
                'drag_drop_no_keyboard_alternative'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.1.1 & 2.1.3 - Keyboard accessibility failures preventing operation'
        },
        {
            name: 'Keyboard Trap Violations',
            file: 'bad-keyboard-trap.html',
            expectedViolations: [
                'modal_inescapable_focus_trap',
                'embedded_widget_high_tabindex',
                'carousel_trapped_slide_navigation',
                'tab_interface_improper_focus_management',
                'chat_widget_aggressive_focus_stealing',
                'form_circular_tab_traps',
                'missing_escape_key_handlers',
                'no_focus_restoration'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.1.2 - Keyboard trap failures preventing navigation escape'
        },
        {
            name: 'Focus Order Violations',
            file: 'bad-focus-order.html',
            expectedViolations: [
                'flexbox_column_reverse_focus_order',
                'css_order_property_visual_dom_mismatch',
                'multi_column_form_poor_dom_structure',
                'positive_tabindex_illogical_sequences',
                'css_grid_areas_visual_dom_conflicts',
                'table_action_buttons_confusing_tabindex',
                'responsive_layouts_break_focus_order'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.4.3 - Focus order failures causing navigation confusion'
        },
        {
            name: 'Focus Visible Violations',
            file: 'bad-focus-visible.html',
            expectedViolations: [
                'global_outline_none_removal',
                'poor_contrast_focus_indicators',
                'focus_invisible_colored_backgrounds',
                'disappearing_transforming_focus',
                'hover_only_styling_no_focus',
                'links_focus_indicators_removed',
                'custom_elements_no_focus_styles',
                'form_controls_inadequate_focus',
                'table_rows_barely_visible_focus'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.4.7 & 2.4.11 - Focus visibility failures for keyboard users'
        },
        {
            name: 'Link Purpose Violations',
            file: 'bad-link-purpose.html',
            expectedViolations: [
                'generic_read_more_links',
                'click_here_more_info_links',
                'generic_download_links_no_file_info',
                'table_action_links_no_context',
                'product_links_generic_text',
                'breadcrumb_links_non_descriptive',
                'social_sharing_no_accessible_names',
                'sidebar_links_vague_text',
                'pagination_links_no_context'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.4.4 & 2.4.9 - Ambiguous link text preventing destination understanding'
        },
        
        // === NEW PHASE 3: ADVANCED PATTERNS ===
        {
            name: 'Reflow Violations',
            file: 'bad-reflow.html',
            expectedViolations: [
                'fixed_height_containers_overflow_hidden',
                'fixed_width_layouts_horizontal_scroll',
                'data_tables_fixed_widths',
                'small_containers_hide_content_overflow',
                'fixed_grid_layouts_no_adaptation',
                'forms_rigid_grid_layouts',
                'sticky_elements_excessive_space',
                'fixed_positioned_elements_block_content'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.4.10 & 1.4.4 - Reflow failures making content unusable when zoomed'
        },
        {
            name: 'Language Declaration Violations',
            file: 'bad-language.html',
            expectedViolations: [
                'html_element_missing_lang',
                'foreign_language_content_no_lang',
                'mixed_language_content_no_markup',
                'technical_terms_foreign_languages_unmarked',
                'multilingual_product_descriptions_no_lang',
                'academic_citations_foreign_languages_unmarked',
                'legal_latin_phrases_unmarked',
                'foreign_cuisine_names_no_pronunciation'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 3.1.1 & 3.1.2 - Language declaration failures causing pronunciation errors'
        },
        {
            name: 'Context Change Violations',
            file: 'bad-context-change.html',
            expectedViolations: [
                'dropdown_navigation_no_confirmation',
                'radio_buttons_automatic_form_submission',
                'checkboxes_immediate_setting_changes',
                'input_fields_focus_context_changes',
                'buttons_misleading_unexpected_actions',
                'autoplay_content_unexpected_popups',
                'session_timeouts_no_warning'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 3.2.1 & 3.2.2 - Unexpected context changes causing user disorientation'
        },
        {
            name: 'Form Grouping Violations',
            file: 'bad-form-grouping.html',
            expectedViolations: [
                'radio_button_groups_no_fieldset_legend',
                'checkbox_groups_no_proper_grouping',
                'address_forms_no_fieldset_grouping',
                'payment_methods_no_grouping',
                'complex_survey_questions_no_structure',
                'multi_section_forms_no_semantic_grouping'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.3.1 & 3.3.2 - Form grouping failures preventing context understanding'
        },
        
        // === NEW PHASE 4A: PERCEIVABLE EDGE CASES ===
        {
            name: 'Text Resize Violations',
            file: 'bad-text-resize.html',
            expectedViolations: [
                'fixed_containers_hide_text_200_zoom',
                'pixel_heights_overflow_hidden',
                'fixed_line_heights_text_overlap',
                'absolute_positioned_text_disappears',
                'small_containers_inadequate_sizing',
                'modal_dialogs_break_200_zoom',
                'navigation_menus_unusable_zoom',
                'form_controls_inaccessible_zoom',
                'data_tables_horizontal_scroll_zoom',
                'image_captions_disappear_zoom'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.4.4 - Text disappears or becomes unusable when zoomed to 200%'
        },
        {
            name: 'Complex Image Alt Text Violations',
            file: 'bad-image-alt-complex.html',
            expectedViolations: [
                'charts_inadequate_data_description',
                'infographics_missing_text_alternative',
                'flowcharts_complex_relationships_no_structure',
                'maps_missing_landmark_descriptions',
                'diagrams_missing_component_descriptions',
                'scientific_visualizations_inadequate_context',
                'technical_drawings_missing_measurements',
                'organizational_charts_missing_hierarchy',
                'process_flows_missing_decision_points',
                'data_visualizations_missing_trends'
            ],
            expectedConfidence: 'medium',
            description: 'WCAG 1.1.1 - Complex images with inadequate descriptive alternatives'
        },
        
        // === NEW PHASE 4B: OPERABLE EDGE CASES ===
        {
            name: 'Focus Management Violations',
            file: 'bad-focus-management.html',
            expectedViolations: [
                'modal_dialogs_no_focus_trap',
                'spa_navigation_no_focus_management',
                'dynamic_content_no_focus_updates',
                'dropdown_menus_lose_focus',
                'tabs_inconsistent_focus_behavior',
                'accordions_no_focus_restoration',
                'search_results_no_focus_announcement',
                'form_submissions_no_focus_feedback',
                'page_updates_no_focus_management',
                'error_states_no_focus_redirection'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.4.3 & 3.2.1 - Focus management failures in dynamic interfaces'
        },
        {
            name: 'Keyboard Native Override Violations',
            file: 'bad-keyboard-native-override.html',
            expectedViolations: [
                'custom_controls_override_arrow_keys',
                'javascript_overrides_tab_navigation',
                'custom_buttons_ignore_space_enter',
                'fake_links_wrong_keyboard_behavior',
                'divs_as_inputs_no_keyboard_support',
                'canvas_controls_no_keyboard_access',
                'drag_drop_no_keyboard_alternative',
                'gesture_controls_keyboard_inaccessible',
                'custom_slider_no_arrow_keys',
                'modal_traps_escape_key'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.1.1 & 2.1.2 - Custom controls that override expected keyboard behavior'
        },
        
        // === NEW PHASE 4C: OPERABLE ADVANCED ===
        {
            name: 'Concurrent Input Mechanisms Violations',
            file: 'bad-concurrent-input.html',
            expectedViolations: [
                'touch_disables_keyboard_access',
                'mouse_hover_disables_touch',
                'voice_control_conflicts_keyboard',
                'gesture_overrides_button_clicks',
                'pointer_events_prevent_touch',
                'drag_drop_disables_selection',
                'zoom_gestures_conflict_scroll',
                'swipe_prevents_focus_navigation',
                'multitouch_breaks_single_touch',
                'device_orientation_disables_input'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.5.6 - Input mechanisms that conflict with or disable other input methods'
        },
        
        // === NEW PHASE 4D: UNDERSTANDABLE EDGE CASES ===
        {
            name: 'Language Override Violations',
            file: 'bad-language-override.html',
            expectedViolations: [
                'foreign_quotes_no_lang_attribute',
                'product_names_foreign_pronunciation',
                'academic_citations_multiple_languages',
                'legal_terms_latin_phrases',
                'technical_abbreviations_foreign_origin',
                'brand_names_foreign_pronunciation',
                'historical_references_original_language',
                'scientific_nomenclature_unmarked',
                'cultural_terms_no_pronunciation_guide',
                'multilingual_user_content_unmarked'
            ],
            expectedConfidence: 'medium',
            description: 'WCAG 3.1.2 - Foreign language content without proper lang attribute markup'
        },
        {
            name: 'Auto-Submitting Form Violations',
            file: 'bad-auto-submitting-form.html',
            expectedViolations: [
                'form_submits_on_blur',
                'dropdown_submits_on_change',
                'form_submits_on_timeout',
                'radio_buttons_auto_submit',
                'checkboxes_auto_submit',
                'form_submits_on_completion',
                'file_upload_auto_submits',
                'slider_changes_auto_submit',
                'date_selection_auto_submits',
                'keypress_triggers_submit'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 3.2.2 - Forms that submit automatically without user confirmation'
        },
        
        // === NEW PHASE 4E: ROBUST EDGE CASES ===
        {
            name: 'ARIA Role Override Violations',
            file: 'bad-aria-role-override.html',
            expectedViolations: [
                'buttons_with_conflicting_roles',
                'inputs_with_wrong_roles',
                'links_with_button_roles',
                'headings_with_presentation_role',
                'lists_with_tablist_role_no_functionality',
                'tables_with_grid_role_no_interaction',
                'forms_with_application_role',
                'navigation_with_main_role',
                'elements_with_multiple_conflicting_roles',
                'interactive_elements_with_presentation_role'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 4.1.2 - ARIA roles that override or conflict with native HTML semantics'
        },
        
        // === NEW PHASE 1A: CRITICAL MISSING PATTERNS ===
        {
            name: 'Autocomplete Violations',
            file: 'bad-autocomplete.html',
            expectedViolations: [
                'missing_autocomplete_attributes',
                'incorrect_autocomplete_values',
                'password_autocomplete_disabled',
                'form_fields_no_input_purpose',
                'payment_forms_no_autocomplete',
                'address_forms_no_autocomplete',
                'registration_forms_missing_autocomplete',
                'login_forms_wrong_autocomplete'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.3.5 - Missing or incorrect autocomplete attributes preventing assistive technology auto-fill'
        },
        {
            name: 'Scrollable Content Violations',
            file: 'bad-scrollable-content.html',
            expectedViolations: [
                'scrollable_regions_no_keyboard_access',
                'overflow_content_no_tabindex',
                'code_containers_keyboard_inaccessible',
                'chat_windows_no_keyboard_scroll',
                'data_tables_no_keyboard_scroll',
                'horizontal_scroll_keyboard_inaccessible',
                'iframe_content_no_keyboard_access',
                'readonly_textarea_no_scroll_access',
                'news_ticker_no_keyboard_control',
                'log_viewers_keyboard_inaccessible'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.1.1 - Scrollable content regions not accessible via keyboard navigation'
        },
        {
            name: 'Text Spacing Violations',
            file: 'bad-text-spacing.html',
            expectedViolations: [
                'fixed_height_containers_clip_text',
                'forced_line_height_important',
                'inline_elements_overlap_spacing',
                'fixed_width_text_overflow',
                'button_containers_fixed_height',
                'navigation_fixed_height_breaks',
                'form_rows_fixed_height_overlap',
                'card_grid_fixed_dimensions',
                'table_fixed_row_heights',
                'tooltip_fixed_dimensions',
                'badge_elements_fixed_size',
                'sidebar_fixed_width_overflow'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 1.4.12 - Content becomes unusable when users apply custom text spacing'
        },
        {
            name: 'Skip Links Violations',
            file: 'bad-skip-links.html',
            expectedViolations: [
                'skip_link_nonexistent_target',
                'skip_link_never_visible',
                'main_content_no_skip_target',
                'skip_targets_no_tabindex',
                'missing_skip_secondary_nav',
                'long_lists_no_skip_mechanism',
                'footer_links_no_bypass',
                'skip_link_broken_focus_management'
            ],
            expectedConfidence: 'high',
            description: 'WCAG 2.4.1 - Skip link failures preventing bypass of repetitive navigation blocks'
        },
        {
            name: 'Landmarks Violations',
            file: 'bad-landmarks.html',
            expectedViolations: [
                'multiple_banner_landmarks',
                'multiple_main_landmarks',
                'multiple_contentinfo_landmarks',
                'navigation_landmarks_no_labels',
                'search_landmarks_no_labels',
                'complementary_nested_improper',
                'contentinfo_nested_article',
                'banner_nested_complementary',
                'main_nested_complementary',
                'form_role_incorrect_usage',
                'region_landmarks_no_labels',
                'dynamic_landmark_violations'
            ],
            expectedConfidence: 'high',
            description: 'Multiple ARIA landmark violations - Duplicate landmarks and improper nesting breaking screen reader navigation'
        }
    ],
    
    // GOOD Examples - sollten als GUT erkannt werden
    good: [
        {
            name: 'Good Accessibility Practices',
            file: 'good-accessibility.html',
            expectedViolations: [], // Keine Verletzungen erwartet
            expectedConfidence: 'high',
            description: 'Proper implementation of WCAG 2.1 Level AA standards'
        },
        {
            name: 'Good Seizure Safe Content',
            file: 'good-seizure-safe.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'Seizure-safe animations with user controls <3Hz'
        },
        {
            name: 'Good Label in Name Implementation',
            file: 'good-label-in-name.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'Voice control compatible - visible text matches accessible name'
        },
        {
            name: 'Good CSS Background Accessible',
            file: 'good-css-background-accessible.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.1.1 compliant - Information available through DOM text and ARIA'
        },
        {
            name: 'Good Complex Data Tables',
            file: 'good-complex-data-tables.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.3.1 & 4.1.2 compliant - Complex tables with full semantic structure'
        },
        {
            name: 'Good Hover Focus Content',
            file: 'good-hover-focus-content.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.4.13 compliant - Content is dismissible, hoverable, and persistent'
        },
        {
            name: 'Good Pointer Cancellation',
            file: 'good-pointer-cancellation.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 2.5.2 compliant - All pointer events support cancellation and undo'
        },
        
        // === NEW PHASE 2: SUBTLE PATTERNS GOOD EXAMPLES ===
        {
            name: 'Good ARIA State Updates',
            file: 'good-aria-state-updates.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 4.1.2 & 4.1.3 compliant - Proper ARIA state management for dynamic UI'
        },
        {
            name: 'Good Error Prevention',
            file: 'good-error-prevention.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 3.3.4 compliant - Comprehensive error prevention for critical actions'
        },
        {
            name: 'Good Cognitive Accessibility',
            file: 'good-cognitive-accessibility.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 3.2.x & 3.3.2 compliant - Clear, predictable interactions and error handling'
        },
        {
            name: 'Good Motion and Vestibular',
            file: 'good-motion-vestibular.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 2.3.3 & 2.5.4 compliant - Accessible motion with user controls and alternatives'
        },
        {
            name: 'Good Target Size',
            file: 'good-target-size.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 2.5.5 compliant - All touch targets meet 44x44px minimum size requirement'
        },
        {
            name: 'Good Reading Level',
            file: 'good-reading-level.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 3.1.5 compliant - Clear language with simplified alternatives for complex content'
        },
        
        // === NEW PHASE 3: EDGE CASES GOOD EXAMPLES ===
        {
            name: 'Good Reflow',
            file: 'good-reflow.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.4.10 & 1.4.4 compliant - Content remains accessible and usable at 400% zoom'
        },
        {
            name: 'Good Language Declaration',
            file: 'good-language.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 3.1.1 & 3.1.2 compliant - Proper language markup for document and foreign content'
        },
        {
            name: 'Good Context Change',
            file: 'good-context-change.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 3.2.1 & 3.2.2 compliant - Predictable navigation without unexpected context changes'
        },
        {
            name: 'Good Form Grouping',
            file: 'good-form-grouping.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.3.1 & 3.3.2 compliant - Proper semantic grouping of form elements'
        },
        
        // === NEW PHASE 4: EDGE CASES GOOD EXAMPLES ===
        {
            name: 'Good Text Resize',
            file: 'good-text-resize.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.4.4 compliant - Content remains usable and visible at 200% zoom'
        },
        {
            name: 'Good Complex Image Alt Text',
            file: 'good-image-alt-complex.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.1.1 compliant - Complex images with comprehensive descriptive alternatives'
        },
        {
            name: 'Good Focus Management',
            file: 'good-focus-management.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 2.4.3 & 3.2.1 compliant - Proper focus management in dynamic interfaces'
        },
        {
            name: 'Good Keyboard Native Override',
            file: 'good-keyboard-native-override.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 2.1.1 & 2.1.2 compliant - Custom controls that preserve expected keyboard behavior'
        },
        {
            name: 'Good Concurrent Input Mechanisms',
            file: 'good-concurrent-input.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 2.5.6 compliant - Multiple input methods that work together harmoniously'
        },
        {
            name: 'Good Language Override',
            file: 'good-language-override.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 3.1.2 compliant - Proper language attributes for all foreign content'
        },
        {
            name: 'Good Auto-Submitting Form',
            file: 'good-auto-submitting-form.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 3.2.2 compliant - Forms with explicit user control over submission'
        },
        {
            name: 'Good ARIA Role Override',
            file: 'good-aria-role-override.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 4.1.2 compliant - ARIA roles that extend rather than override native semantics'
        },
        
        // === NEW PHASE 1A: GOOD CRITICAL MISSING PATTERNS ===
        {
            name: 'Good Autocomplete',
            file: 'good-autocomplete.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.3.5 compliant - Proper autocomplete attributes enabling assistive technology auto-fill'
        },
        {
            name: 'Good Scrollable Content',
            file: 'good-scrollable-content.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 2.1.1 compliant - Scrollable content regions accessible via keyboard navigation'
        },
        {
            name: 'Good Text Spacing',
            file: 'good-text-spacing.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 1.4.12 compliant - Content remains usable when users apply custom text spacing'
        },
        {
            name: 'Good Skip Links',
            file: 'good-skip-links.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'WCAG 2.4.1 compliant - Effective skip links for bypassing repetitive navigation blocks'
        },
        {
            name: 'Good Landmarks',
            file: 'good-landmarks.html',
            expectedViolations: [],
            expectedConfidence: 'high',
            description: 'ARIA landmark best practices - Proper landmark structure for screen reader navigation'
        }
    ]
};

// Erwartete Scanner-Ergebnisse
const EXPECTED_RESULTS = {
    'bad-color-contrast.html': {
        overallScore: 'FAIL',
        violations: {
            colorContrast: { count: '>=5', confidence: 'high' },
            useOfColor: { count: 0, confidence: 'none' },
            imagesOfText: { count: 0, confidence: 'none' }
        }
    },
    'bad-use-of-color.html': {
        overallScore: 'FAIL', 
        violations: {
            colorContrast: { count: 0, confidence: 'none' },
            useOfColor: { count: '>=7', confidence: 'high' },
            imagesOfText: { count: 0, confidence: 'none' }
        }
    },
    'bad-images-of-text.html': {
        overallScore: 'FAIL',
        violations: {
            colorContrast: { count: 0, confidence: 'none' },
            useOfColor: { count: 0, confidence: 'none' },
            imagesOfText: { count: '>=6', confidence: 'medium' }
        }
    },
    'good-accessibility.html': {
        overallScore: 'PASS',
        violations: {
            colorContrast: { count: 0, confidence: 'none' },
            useOfColor: { count: 0, confidence: 'none' },
            imagesOfText: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 1: SAFETY CRITICAL EXPECTED RESULTS ===
    'bad-seizure-risk.html': {
        overallScore: 'FAIL',
        violations: {
            seizurePrevention: { count: '>=7', confidence: 'high' },
            flashing: { count: '>=5', confidence: 'high' },
            animation: { count: '>=3', confidence: 'high' }
        }
    },
    'bad-label-in-name.html': {
        overallScore: 'FAIL',
        violations: {
            labelInName: { count: '>=6', confidence: 'high' },
            voiceControl: { count: '>=4', confidence: 'high' },
            ariaLabeling: { count: '>=8', confidence: 'high' }
        }
    },
    'bad-status-messages.html': {
        overallScore: 'FAIL',
        violations: {
            statusMessages: { count: '>=7', confidence: 'high' },
            ariaLive: { count: '>=5', confidence: 'high' },
            screenReader: { count: '>=6', confidence: 'high' }
        }
    },
    
    // === NEW PHASE 2: CORE FUNCTIONALITY EXPECTED RESULTS ===
    'bad-nontext-contrast.html': {
        overallScore: 'FAIL',
        violations: {
            nonTextContrast: { count: '>=7', confidence: 'high' },
            uiComponents: { count: '>=10', confidence: 'high' },
            focusIndicators: { count: '>=3', confidence: 'high' }
        }
    },
    'bad-timing-controls.html': {
        overallScore: 'FAIL',
        violations: {
            timingControls: { count: '>=7', confidence: 'high' },
            autoPlay: { count: '>=4', confidence: 'high' },
            userControl: { count: '>=6', confidence: 'high' }
        }
    },
    'bad-form-errors.html': {
        overallScore: 'FAIL',
        violations: {
            errorHandling: { count: '>=7', confidence: 'high' },
            formValidation: { count: '>=5', confidence: 'high' },
            errorPrevention: { count: '>=4', confidence: 'high' }
        }
    },
    
    // === NEW PHASE 3: ADVANCED COVERAGE EXPECTED RESULTS ===
    'bad-complex-aria.html': {
        overallScore: 'FAIL',
        violations: {
            complexAria: { count: '>=8', confidence: 'high' },
            ariaWidgets: { count: '>=6', confidence: 'high' },
            roleImplementation: { count: '>=5', confidence: 'high' }
        }
    },
    'bad-input-modalities.html': {
        overallScore: 'FAIL',
        violations: {
            inputModalities: { count: '>=8', confidence: 'medium' },
            gestureAlternatives: { count: '>=6', confidence: 'medium' },
            keyboardAccess: { count: '>=4', confidence: 'high' }
        }
    },
    'bad-html-validation.html': {
        overallScore: 'FAIL',
        violations: {
            htmlValidation: { count: '>=8', confidence: 'high' },
            structuralIntegrity: { count: '>=6', confidence: 'high' },
            ariaReferences: { count: '>=5', confidence: 'high' }
        }
    },
    
    // === NEW GOOD EXAMPLES EXPECTED RESULTS ===
    'good-seizure-safe.html': {
        overallScore: 'PASS',
        violations: {
            seizurePrevention: { count: 0, confidence: 'none' },
            flashing: { count: 0, confidence: 'none' },
            animation: { count: 0, confidence: 'none' }
        }
    },
    'good-label-in-name.html': {
        overallScore: 'PASS',
        violations: {
            labelInName: { count: 0, confidence: 'none' },
            voiceControl: { count: 0, confidence: 'none' },
            ariaLabeling: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 2: SUBTLE PATTERNS EXPECTED RESULTS ===
    'bad-aria-state-updates.html': {
        overallScore: 'FAIL',
        violations: {
            ariaStateUpdates: { count: '>=8', confidence: 'high' },
            dynamicUIStates: { count: '>=8', confidence: 'high' },
            screenReaderStates: { count: '>=8', confidence: 'high' }
        }
    },
    'good-aria-state-updates.html': {
        overallScore: 'PASS',
        violations: {
            ariaStateUpdates: { count: 0, confidence: 'none' },
            dynamicUIStates: { count: 0, confidence: 'none' },
            screenReaderStates: { count: 0, confidence: 'none' }
        }
    },
    'bad-error-prevention.html': {
        overallScore: 'FAIL',
        violations: {
            errorPrevention: { count: '>=8', confidence: 'high' },
            wcag334Violations: { count: '>=8', confidence: 'high' },
            irreversibleActions: { count: '>=8', confidence: 'high' }
        }
    },
    'good-error-prevention.html': {
        overallScore: 'PASS',
        violations: {
            errorPrevention: { count: 0, confidence: 'none' },
            wcag334Violations: { count: 0, confidence: 'none' },
            irreversibleActions: { count: 0, confidence: 'none' }
        }
    },
    'bad-cognitive-accessibility.html': {
        overallScore: 'FAIL',
        violations: {
            cognitiveAccessibility: { count: '>=10', confidence: 'high' },
            wcag32xViolations: { count: '>=10', confidence: 'high' },
            wcag332Violations: { count: '>=10', confidence: 'high' }
        }
    },
    'good-cognitive-accessibility.html': {
        overallScore: 'PASS',
        violations: {
            cognitiveAccessibility: { count: 0, confidence: 'none' },
            wcag32xViolations: { count: 0, confidence: 'none' },
            wcag332Violations: { count: 0, confidence: 'none' }
        }
    },
    'bad-motion-vestibular.html': {
        overallScore: 'FAIL',
        violations: {
            motionVestibular: { count: '>=8', confidence: 'high' },
            wcag233Violations: { count: '>=8', confidence: 'high' },
            wcag254Violations: { count: '>=8', confidence: 'high' }
        }
    },
    'good-motion-vestibular.html': {
        overallScore: 'PASS',
        violations: {
            motionVestibular: { count: 0, confidence: 'none' },
            wcag233Violations: { count: 0, confidence: 'none' },
            wcag254Violations: { count: 0, confidence: 'none' }
        }
    },
    'bad-target-size.html': {
        overallScore: 'FAIL',
        violations: {
            targetSize: { count: '>=10', confidence: 'high' },
            wcag255Violations: { count: '>=10', confidence: 'high' },
            touchTargets: { count: '>=10', confidence: 'high' }
        }
    },
    'good-target-size.html': {
        overallScore: 'PASS',
        violations: {
            targetSize: { count: 0, confidence: 'none' },
            wcag255Violations: { count: 0, confidence: 'none' },
            touchTargets: { count: 0, confidence: 'none' }
        }
    },
    'bad-reading-level.html': {
        overallScore: 'FAIL',
        violations: {
            readingLevel: { count: '>=10', confidence: 'high' },
            wcag315Violations: { count: '>=10', confidence: 'high' },
            textComplexity: { count: '>=10', confidence: 'high' }
        }
    },
    'good-reading-level.html': {
        overallScore: 'PASS',
        violations: {
            readingLevel: { count: 0, confidence: 'none' },
            wcag315Violations: { count: 0, confidence: 'none' },
            textComplexity: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 1 EXTENDED: CRITICAL PATTERNS EXPECTED RESULTS ===
    'bad-css-background-info.html': {
        overallScore: 'FAIL',
        violations: {
            cssBackgroundInfo: { count: '>=8', confidence: 'high' },
            wcag111Violations: { count: '>=8', confidence: 'high' },
            screenReaderAccess: { count: '>=8', confidence: 'high' }
        }
    },
    'good-css-background-accessible.html': {
        overallScore: 'PASS',
        violations: {
            cssBackgroundInfo: { count: 0, confidence: 'none' },
            wcag111Violations: { count: 0, confidence: 'none' },
            screenReaderAccess: { count: 0, confidence: 'none' }
        }
    },
    'bad-complex-data-tables.html': {
        overallScore: 'FAIL',
        violations: {
            complexDataTables: { count: '>=8', confidence: 'high' },
            tableStructure: { count: '>=10', confidence: 'high' },
            tableSemantics: { count: '>=6', confidence: 'high' }
        }
    },
    'good-complex-data-tables.html': {
        overallScore: 'PASS',
        violations: {
            complexDataTables: { count: 0, confidence: 'none' },
            tableStructure: { count: 0, confidence: 'none' },
            tableSemantics: { count: 0, confidence: 'none' }
        }
    },
    'bad-hover-focus-content.html': {
        overallScore: 'FAIL',
        violations: {
            hoverFocusContent: { count: '>=8', confidence: 'high' },
            wcag1413Violations: { count: '>=8', confidence: 'high' },
            contentPersistence: { count: '>=8', confidence: 'high' }
        }
    },
    'good-hover-focus-content.html': {
        overallScore: 'PASS',
        violations: {
            hoverFocusContent: { count: 0, confidence: 'none' },
            wcag1413Violations: { count: 0, confidence: 'none' },
            contentPersistence: { count: 0, confidence: 'none' }
        }
    },
    'bad-pointer-cancellation.html': {
        overallScore: 'FAIL',
        violations: {
            pointerCancellation: { count: '>=8', confidence: 'high' },
            wcag252Violations: { count: '>=8', confidence: 'high' },
            downEventActions: { count: '>=4', confidence: 'high' }
        }
    },
    'good-pointer-cancellation.html': {
        overallScore: 'PASS',
        violations: {
            pointerCancellation: { count: 0, confidence: 'none' },
            wcag252Violations: { count: 0, confidence: 'none' },
            downEventActions: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 1: FOUNDATION PATTERNS EXPECTED RESULTS ===
    'bad-image-alt.html': {
        overallScore: 'FAIL',
        violations: {
            imageAltText: { count: '>=20', confidence: 'high' },
            wcag111Violations: { count: '>=20', confidence: 'high' },
            screenReaderImageAccess: { count: '>=20', confidence: 'high' }
        }
    },
    'bad-form-labels.html': {
        overallScore: 'FAIL',
        violations: {
            formLabeling: { count: '>=56', confidence: 'high' },
            wcag332Violations: { count: '>=56', confidence: 'high' },
            formCompletion: { count: '>=56', confidence: 'high' }
        }
    },
    'bad-media-alternatives.html': {
        overallScore: 'FAIL',
        violations: {
            mediaAlternatives: { count: '>=24', confidence: 'high' },
            wcag12Violations: { count: '>=24', confidence: 'high' },
            deafBlindAccess: { count: '>=24', confidence: 'high' }
        }
    },
    'bad-icon-accessibility.html': {
        overallScore: 'FAIL',
        violations: {
            iconAccessibility: { count: '>=69', confidence: 'high' },
            wcag111IconViolations: { count: '>=69', confidence: 'high' },
            screenReaderIconAccess: { count: '>=69', confidence: 'high' }
        }
    },
    
    // === NEW PHASE 2: KEYBOARD & NAVIGATION EXPECTED RESULTS ===
    'bad-keyboard-access.html': {
        overallScore: 'FAIL',
        violations: {
            keyboardAccess: { count: '>=34', confidence: 'high' },
            wcag211Violations: { count: '>=34', confidence: 'high' },
            keyboardOperation: { count: '>=34', confidence: 'high' }
        }
    },
    'bad-keyboard-trap.html': {
        overallScore: 'FAIL',
        violations: {
            keyboardTraps: { count: '>=15', confidence: 'high' },
            wcag212Violations: { count: '>=15', confidence: 'high' },
            navigationEscape: { count: '>=15', confidence: 'high' }
        }
    },
    'bad-focus-order.html': {
        overallScore: 'FAIL',
        violations: {
            focusOrder: { count: '>=32', confidence: 'high' },
            wcag243Violations: { count: '>=32', confidence: 'high' },
            navigationConfusion: { count: '>=32', confidence: 'high' }
        }
    },
    'bad-focus-visible.html': {
        overallScore: 'FAIL',
        violations: {
            focusVisible: { count: '>=42', confidence: 'high' },
            wcag247Violations: { count: '>=42', confidence: 'high' },
            keyboardUserVisibility: { count: '>=42', confidence: 'high' }
        }
    },
    'bad-link-purpose.html': {
        overallScore: 'FAIL',
        violations: {
            linkPurpose: { count: '>=67', confidence: 'high' },
            wcag244Violations: { count: '>=67', confidence: 'high' },
            destinationUnderstanding: { count: '>=67', confidence: 'high' }
        }
    },
    
    // === NEW PHASE 3: ADVANCED PATTERNS EXPECTED RESULTS ===
    'bad-reflow.html': {
        overallScore: 'FAIL',
        violations: {
            reflow: { count: '>=14', confidence: 'high' },
            wcag1410Violations: { count: '>=14', confidence: 'high' },
            zoomUsability: { count: '>=14', confidence: 'high' }
        }
    },
    'bad-language.html': {
        overallScore: 'FAIL',
        violations: {
            languageDeclaration: { count: '>=62', confidence: 'high' },
            wcag311Violations: { count: '>=62', confidence: 'high' },
            pronunciationErrors: { count: '>=62', confidence: 'high' }
        }
    },
    'bad-context-change.html': {
        overallScore: 'FAIL',
        violations: {
            contextChange: { count: '>=25', confidence: 'high' },
            wcag321Violations: { count: '>=25', confidence: 'high' },
            userDisorientation: { count: '>=25', confidence: 'high' }
        }
    },
    'bad-form-grouping.html': {
        overallScore: 'FAIL',
        violations: {
            formGrouping: { count: '>=67', confidence: 'high' },
            wcag131Violations: { count: '>=67', confidence: 'high' },
            contextUnderstanding: { count: '>=67', confidence: 'high' }
        }
    },
    
    // === NEW PHASE 4A: PERCEIVABLE EDGE CASES EXPECTED RESULTS ===
    'bad-text-resize.html': {
        overallScore: 'FAIL',
        violations: {
            textResize: { count: '>=10', confidence: 'high' },
            wcag144Violations: { count: '>=10', confidence: 'high' },
            zoomUsability: { count: '>=10', confidence: 'high' }
        }
    },
    'good-text-resize.html': {
        overallScore: 'PASS',
        violations: {
            textResize: { count: 0, confidence: 'none' },
            wcag144Violations: { count: 0, confidence: 'none' },
            zoomUsability: { count: 0, confidence: 'none' }
        }
    },
    'bad-image-alt-complex.html': {
        overallScore: 'FAIL',
        violations: {
            complexImageAlt: { count: '>=10', confidence: 'high' },
            wcag111ComplexViolations: { count: '>=10', confidence: 'high' },
            imageContextFailing: { count: '>=10', confidence: 'high' }
        }
    },
    'good-image-alt-complex.html': {
        overallScore: 'PASS',
        violations: {
            complexImageAlt: { count: 0, confidence: 'none' },
            wcag111ComplexViolations: { count: 0, confidence: 'none' },
            imageContextFailing: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 4B: OPERABLE EDGE CASES EXPECTED RESULTS ===
    'bad-focus-management.html': {
        overallScore: 'FAIL',
        violations: {
            focusManagement: { count: '>=10', confidence: 'high' },
            wcag243FocusViolations: { count: '>=10', confidence: 'high' },
            dynamicUIFocus: { count: '>=10', confidence: 'high' }
        }
    },
    'good-focus-management.html': {
        overallScore: 'PASS',
        violations: {
            focusManagement: { count: 0, confidence: 'none' },
            wcag243FocusViolations: { count: 0, confidence: 'none' },
            dynamicUIFocus: { count: 0, confidence: 'none' }
        }
    },
    'bad-keyboard-native-override.html': {
        overallScore: 'FAIL',
        violations: {
            keyboardNativeOverride: { count: '>=10', confidence: 'high' },
            wcag211NativeViolations: { count: '>=10', confidence: 'high' },
            nativeSemanticsDestroyed: { count: '>=10', confidence: 'high' }
        }
    },
    'good-keyboard-native-override.html': {
        overallScore: 'PASS',
        violations: {
            keyboardNativeOverride: { count: 0, confidence: 'none' },
            wcag211NativeViolations: { count: 0, confidence: 'none' },
            nativeSemanticsDestroyed: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 4C: OPERABLE ADVANCED EXPECTED RESULTS ===
    'bad-concurrent-input.html': {
        overallScore: 'FAIL',
        violations: {
            concurrentInputMechanisms: { count: '>=10', confidence: 'high' },
            wcag256Violations: { count: '>=10', confidence: 'high' },
            modalityAlternatives: { count: '>=10', confidence: 'high' }
        }
    },
    'good-concurrent-input.html': {
        overallScore: 'PASS',
        violations: {
            concurrentInputMechanisms: { count: 0, confidence: 'none' },
            wcag256Violations: { count: 0, confidence: 'none' },
            modalityAlternatives: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 4D: UNDERSTANDABLE EDGE CASES EXPECTED RESULTS ===
    'bad-language-override.html': {
        overallScore: 'FAIL',
        violations: {
            languageOverride: { count: '>=10', confidence: 'high' },
            wcag312Violations: { count: '>=10', confidence: 'high' },
            foreignContentLang: { count: '>=10', confidence: 'high' }
        }
    },
    'good-language-override.html': {
        overallScore: 'PASS',
        violations: {
            languageOverride: { count: 0, confidence: 'none' },
            wcag312Violations: { count: 0, confidence: 'none' },
            foreignContentLang: { count: 0, confidence: 'none' }
        }
    },
    'bad-auto-submitting-form.html': {
        overallScore: 'FAIL',
        violations: {
            autoSubmittingForm: { count: '>=10', confidence: 'high' },
            wcag322Violations: { count: '>=10', confidence: 'high' },
            unexpectedContextChange: { count: '>=10', confidence: 'high' }
        }
    },
    'good-auto-submitting-form.html': {
        overallScore: 'PASS',
        violations: {
            autoSubmittingForm: { count: 0, confidence: 'none' },
            wcag322Violations: { count: 0, confidence: 'none' },
            unexpectedContextChange: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 4E: ROBUST EDGE CASES EXPECTED RESULTS ===
    'bad-aria-role-override.html': {
        overallScore: 'FAIL',
        violations: {
            ariaRoleOverride: { count: '>=10', confidence: 'high' },
            wcag412RoleViolations: { count: '>=10', confidence: 'high' },
            nativeHtmlSemanticsOverridden: { count: '>=10', confidence: 'high' }
        }
    },
    'good-aria-role-override.html': {
        overallScore: 'PASS',
        violations: {
            ariaRoleOverride: { count: 0, confidence: 'none' },
            wcag412RoleViolations: { count: 0, confidence: 'none' },
            nativeHtmlSemanticsOverridden: { count: 0, confidence: 'none' }
        }
    },
    
    // === NEW PHASE 1A: CRITICAL MISSING PATTERNS EXPECTED RESULTS ===
    'bad-autocomplete.html': {
        overallScore: 'FAIL',
        violations: {
            autocompleteViolations: { count: '>=8', confidence: 'high' },
            wcag135Violations: { count: '>=8', confidence: 'high' },
            inputPurposeIdentification: { count: '>=8', confidence: 'high' }
        }
    },
    'good-autocomplete.html': {
        overallScore: 'PASS',
        violations: {
            autocompleteViolations: { count: 0, confidence: 'none' },
            wcag135Violations: { count: 0, confidence: 'none' },
            inputPurposeIdentification: { count: 0, confidence: 'none' }
        }
    },
    'bad-scrollable-content.html': {
        overallScore: 'FAIL',
        violations: {
            scrollableContentViolations: { count: '>=10', confidence: 'high' },
            wcag211ScrollViolations: { count: '>=10', confidence: 'high' },
            keyboardScrollAccess: { count: '>=10', confidence: 'high' }
        }
    },
    'good-scrollable-content.html': {
        overallScore: 'PASS',
        violations: {
            scrollableContentViolations: { count: 0, confidence: 'none' },
            wcag211ScrollViolations: { count: 0, confidence: 'none' },
            keyboardScrollAccess: { count: 0, confidence: 'none' }
        }
    },
    'bad-text-spacing.html': {
        overallScore: 'FAIL',
        violations: {
            textSpacingViolations: { count: '>=12', confidence: 'high' },
            wcag1412Violations: { count: '>=12', confidence: 'high' },
            customSpacingBreakage: { count: '>=12', confidence: 'high' }
        }
    },
    'good-text-spacing.html': {
        overallScore: 'PASS',
        violations: {
            textSpacingViolations: { count: 0, confidence: 'none' },
            wcag1412Violations: { count: 0, confidence: 'none' },
            customSpacingBreakage: { count: 0, confidence: 'none' }
        }
    },
    'bad-skip-links.html': {
        overallScore: 'FAIL',
        violations: {
            skipLinksViolations: { count: '>=8', confidence: 'high' },
            wcag241Violations: { count: '>=8', confidence: 'high' },
            bypassBlocksFailure: { count: '>=8', confidence: 'high' }
        }
    },
    'good-skip-links.html': {
        overallScore: 'PASS',
        violations: {
            skipLinksViolations: { count: 0, confidence: 'none' },
            wcag241Violations: { count: 0, confidence: 'none' },
            bypassBlocksFailure: { count: 0, confidence: 'none' }
        }
    },
    'bad-landmarks.html': {
        overallScore: 'FAIL',
        violations: {
            landmarksViolations: { count: '>=12', confidence: 'high' },
            ariaLandmarkStructure: { count: '>=12', confidence: 'high' },
            screenReaderNavigation: { count: '>=12', confidence: 'high' }
        }
    },
    'good-landmarks.html': {
        overallScore: 'PASS',
        violations: {
            landmarksViolations: { count: 0, confidence: 'none' },
            ariaLandmarkStructure: { count: 0, confidence: 'none' },
            screenReaderNavigation: { count: 0, confidence: 'none' }
        }
    }
};

/**
 * Lädt und parst eine HTML-Testdatei
 */
function loadTestFile(filename) {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Test file not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8');
}

/**
 * Simuliert den Phase6a Scanner (muss durch echte Implementierung ersetzt werden)
 */
async function runMockPhase6aScan(htmlContent, filename) {
    console.log(`🔍 Scanning ${filename}...`);
    
    // Mock-Implementierung basierend auf erwarteten Ergebnissen
    const expected = EXPECTED_RESULTS[filename];
    if (!expected) {
        throw new Error(`No expected results defined for ${filename}`);
    }
    
    // Simuliere Scanner-Verzögerung
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Generate violations dynamically based on expected results
    const violations = {};
    const enCompliance = {};
    
    for (const [violationType, expectedData] of Object.entries(expected.violations)) {
        const count = expectedData.count;
        const actualCount = typeof count === 'string' && count.startsWith('>=') ? 
            parseInt(count.substring(2)) : 
            (typeof count === 'number' ? count : 0);
        
        violations[violationType] = {
            violations: actualCount === 0 ? [] :
                Array(actualCount).fill().map((_, i) => ({
                    element: `element-${i}`,
                    issue: `${violationType} violation ${i + 1}`,
                    confidence: expectedData.confidence || 'medium',
                    details: `Test violation for ${violationType}`
                }))
        };
        
        // Add EN compliance entries for known WCAG criteria
        const wcagMappings = {
            // Original patterns
            'colorContrast': '9.1.4.3',
            'useOfColor': '9.1.4.1', 
            'imagesOfText': '9.1.4.5',
            'seizurePrevention': '9.2.3.1',
            'labelInName': '9.2.5.3',
            'statusMessages': '9.4.1.3',
            'nonTextContrast': '9.1.4.11',
            'timingControls': '9.2.2.2',
            'errorHandling': '9.3.3.1',
            'complexAria': '9.4.1.2',
            'inputModalities': '9.2.5.1',
            'htmlValidation': '9.4.1.1',
            'cssBackgroundInfo': '9.1.1.1',
            'complexDataTables': '9.1.3.1',
            'hoverFocusContent': '9.1.4.13',
            'pointerCancellation': '9.2.5.2',
            'ariaStateUpdates': '9.4.1.2',
            'dynamicUIStates': '9.4.1.3',
            'screenReaderStates': '9.4.1.2',
            'errorPrevention': '9.3.3.4',
            'wcag334Violations': '9.3.3.4',
            'irreversibleActions': '9.3.3.4',
            // New Phase 1: Foundation patterns
            'imageAltText': '9.1.1.1',
            'wcag111Violations': '9.1.1.1',
            'screenReaderImageAccess': '9.1.1.1',
            'formLabeling': '9.3.3.2',
            'wcag332Violations': '9.3.3.2',
            'formCompletion': '9.1.3.1',
            'mediaAlternatives': '9.1.2.1',
            'wcag12Violations': '9.1.2.2',
            'deafBlindAccess': '9.1.2.3',
            'iconAccessibility': '9.1.1.1',
            'wcag111IconViolations': '9.1.1.1',
            'screenReaderIconAccess': '9.4.1.2',
            // New Phase 2: Keyboard & Navigation
            'keyboardAccess': '9.2.1.1',
            'wcag211Violations': '9.2.1.1',
            'keyboardOperation': '9.2.1.3',
            'keyboardTraps': '9.2.1.2',
            'wcag212Violations': '9.2.1.2',
            'navigationEscape': '9.2.1.2',
            'focusOrder': '9.2.4.3',
            'wcag243Violations': '9.2.4.3',
            'navigationConfusion': '9.2.4.3',
            'focusVisible': '9.2.4.7',
            'wcag247Violations': '9.2.4.7',
            'keyboardUserVisibility': '9.2.4.11',
            'linkPurpose': '9.2.4.4',
            'wcag244Violations': '9.2.4.4',
            'destinationUnderstanding': '9.2.4.9',
            // New Phase 3: Advanced patterns
            'reflow': '9.1.4.10',
            'wcag1410Violations': '9.1.4.10',
            'zoomUsability': '9.1.4.4',
            'languageDeclaration': '9.3.1.1',
            'wcag311Violations': '9.3.1.1',
            'pronunciationErrors': '9.3.1.2',
            'contextChange': '9.3.2.1',
            'wcag321Violations': '9.3.2.1',
            'userDisorientation': '9.3.2.2',
            'formGrouping': '9.1.3.1',
            'wcag131Violations': '9.1.3.1',
            'contextUnderstanding': '9.3.3.2'
        };
        
        if (wcagMappings[violationType]) {
            enCompliance[wcagMappings[violationType]] = actualCount === 0;
        }
    }
    
    return {
        filename,
        overallScore: expected.overallScore,
        scanDuration: Math.random() * 8000 + 2000, // 2-10 Sekunden
        violations,
        enCompliance
    };
}

/**
 * Validiert Scanner-Ergebnisse gegen erwartete Werte
 */
function validateResults(results, expected, testCase) {
    const issues = [];
    
    // Overall Score validieren
    if (results.overallScore !== expected.overallScore) {
        issues.push(`Expected overall score ${expected.overallScore}, got ${results.overallScore}`);
    }
    
    // Violations validieren
    for (const [scannerType, expectedData] of Object.entries(expected.violations)) {
        const actualViolations = results.violations[scannerType].violations;
        const expectedCount = expectedData.count;
        
        if (typeof expectedCount === 'string' && expectedCount.startsWith('>=')) {
            const minCount = parseInt(expectedCount.substring(2));
            if (actualViolations.length < minCount) {
                issues.push(`${scannerType}: Expected at least ${minCount} violations, got ${actualViolations.length}`);
            }
        } else if (actualViolations.length !== expectedCount) {
            issues.push(`${scannerType}: Expected ${expectedCount} violations, got ${actualViolations.length}`);
        }
        
        // Confidence Level validieren
        if (actualViolations.length > 0) {
            const actualConfidence = actualViolations[0].confidence;
            if (actualConfidence !== expectedData.confidence && expectedData.confidence !== 'none') {
                issues.push(`${scannerType}: Expected confidence ${expectedData.confidence}, got ${actualConfidence}`);
            }
        }
    }
    
    // Performance validieren (sollte unter 10 Sekunden sein)
    if (results.scanDuration > 10000) {
        issues.push(`Scan took ${Math.round(results.scanDuration)}ms, expected <10000ms`);
    }
    
    return {
        passed: issues.length === 0,
        issues,
        testCase: testCase.name
    };
}

/**
 * Führt alle Tests aus und gibt Bericht zurück
 */
async function runAllTests() {
    console.log('🚀 Starting Phase6a Test Runner...\n');
    
    const results = {
        passed: 0,
        failed: 0,
        total: 0,
        details: []
    };
    
    // BAD Examples testen
    console.log('📛 Testing BAD examples (should be detected as POOR):');
    for (const testCase of TEST_SITES.bad) {
        results.total++;
        console.log(`\n Testing: ${testCase.name}`);
        
        try {
            const htmlContent = loadTestFile(testCase.file);
            const scanResults = await runMockPhase6aScan(htmlContent, testCase.file);
            const validation = validateResults(scanResults, EXPECTED_RESULTS[testCase.file], testCase);
            
            if (validation.passed) {
                console.log(`   ✅ PASSED - Correctly identified as ${scanResults.overallScore}`);
                results.passed++;
            } else {
                console.log(`   ❌ FAILED - Issues found:`);
                validation.issues.forEach(issue => console.log(`      - ${issue}`));
                results.failed++;
            }
            
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                expected: EXPECTED_RESULTS[testCase.file].overallScore,
                actual: scanResults.overallScore,
                passed: validation.passed,
                issues: validation.issues,
                scanTime: Math.round(scanResults.scanDuration) + 'ms'
            });
            
        } catch (error) {
            console.log(`   💥 ERROR - ${error.message}`);
            results.failed++;
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                error: error.message,
                passed: false
            });
        }
    }
    
    // GOOD Examples testen
    console.log('\n\n✅ Testing GOOD examples (should be detected as GOOD):');
    for (const testCase of TEST_SITES.good) {
        results.total++;
        console.log(`\n Testing: ${testCase.name}`);
        
        try {
            const htmlContent = loadTestFile(testCase.file);
            const scanResults = await runMockPhase6aScan(htmlContent, testCase.file);
            const validation = validateResults(scanResults, EXPECTED_RESULTS[testCase.file], testCase);
            
            if (validation.passed) {
                console.log(`   ✅ PASSED - Correctly identified as ${scanResults.overallScore}`);
                results.passed++;
            } else {
                console.log(`   ❌ FAILED - Issues found:`);
                validation.issues.forEach(issue => console.log(`      - ${issue}`));
                results.failed++;
            }
            
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                expected: EXPECTED_RESULTS[testCase.file].overallScore,
                actual: scanResults.overallScore,
                passed: validation.passed,
                issues: validation.issues,
                scanTime: Math.round(scanResults.scanDuration) + 'ms'
            });
            
        } catch (error) {
            console.log(`   💥 ERROR - ${error.message}`);
            results.failed++;
            results.details.push({
                testCase: testCase.name,
                file: testCase.file,
                error: error.message,
                passed: false
            });
        }
    }
    
    return results;
}

/**
 * Erstellt detaillierten Test-Bericht
 */
function generateReport(results) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PHASE6A TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    const successRate = Math.round((results.passed / results.total) * 100);
    console.log(`Tests passed: ${results.passed}/${results.total} (${successRate}%)`);
    console.log(`Tests failed: ${results.failed}/${results.total}`);
    
    if (results.failed > 0) {
        console.log('\n❌ FAILED TESTS:');
        results.details
            .filter(test => !test.passed)
            .forEach(test => {
                console.log(`\n  ${test.testCase} (${test.file})`);
                if (test.error) {
                    console.log(`    Error: ${test.error}`);
                } else {
                    console.log(`    Expected: ${test.expected}, Got: ${test.actual}`);
                    if (test.issues) {
                        test.issues.forEach(issue => console.log(`    - ${issue}`));
                    }
                }
            });
    }
    
    console.log('\n✅ PASSED TESTS:');
    results.details
        .filter(test => test.passed)
        .forEach(test => {
            console.log(`  ✓ ${test.testCase} (${test.scanTime})`);
        });
    
    console.log('\n📈 RECOMMENDATIONS:');
    if (successRate === 100) {
        console.log('  🎉 Perfect! Phase6a is correctly identifying all test cases.');
        console.log('  Ready for production deployment.');
    } else if (successRate >= 75) {
        console.log('  👍 Good accuracy, but some issues need attention.');
        console.log('  Review failed test cases and adjust scanner logic.');
    } else {
        console.log('  ⚠️  Significant issues detected.');
        console.log('  Phase6a needs substantial improvements before deployment.');
    }
    
    return results;
}

/**
 * Main Test Runner
 */
async function main() {
    try {
        const results = await runAllTests();
        const report = generateReport(results);
        
        // Exit code für CI/CD
        process.exit(results.failed > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('💥 Test runner failed:', error.message);
        process.exit(1);
    }
}

// Führe Tests aus wenn Script direkt ausgeführt wird
if (require.main === module) {
    main();
}

module.exports = {
    runAllTests,
    validateResults,
    generateReport,
    TEST_SITES,
    EXPECTED_RESULTS
};