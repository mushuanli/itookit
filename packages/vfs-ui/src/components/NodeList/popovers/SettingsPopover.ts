/**
 * @file vfs-ui/components/NodeList/popovers/SettingsPopover.ts
 * @desc Handles the settings popover display and interaction
 */
import type { Coordinator } from '../../../core/Coordinator';
import type { UISettings } from '../../../types/types';
import { createSettingsPopoverHTML } from '../templates';

export class SettingsPopover {
  private element: HTMLElement | null = null;

  constructor(
    private readonly coordinator: Coordinator,
    private readonly containerEl: HTMLElement
  ) {}

  toggle(currentSettings: UISettings): void {
    if (this.element) {
      this.hide();
    } else {
      this.show(currentSettings);
    }
  }

  show(currentSettings: UISettings): void {
    if (this.element) return;

    const container = document.createElement('div');
    container.innerHTML = createSettingsPopoverHTML(currentSettings);
    this.element = container.firstElementChild as HTMLElement;

    this.element.addEventListener('click', this.handleChange);
    this.element.addEventListener('change', this.handleChange);

    this.containerEl.appendChild(this.element);
  }

  hide(): void {
    if (this.element) {
      this.element.removeEventListener('click', this.handleChange);
      this.element.removeEventListener('change', this.handleChange);
      this.element.remove();
      this.element = null;
    }
  }

  isVisible(): boolean {
    return this.element !== null;
  }

  private handleChange = (event: Event): void => {
    const target = event.target as Element;
    const optionBtn = target.closest<HTMLElement>('[data-value]');
    const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"]');

    const newSettings: Partial<UISettings> = {};

    if (optionBtn) {
      const settingGroup = optionBtn.closest<HTMLElement>('[data-setting]');
      if (settingGroup?.dataset.setting) {
        const key = settingGroup.dataset.setting as keyof UISettings;
        (newSettings as any)[key] = optionBtn.dataset.value;
      }
    } else if (checkbox?.dataset.key) {
      const key = checkbox.dataset.key;
      const settingName = `show${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof UISettings;
      (newSettings as any)[settingName] = checkbox.checked;
    } else {
      return;
    }

    this.coordinator.publish('SETTINGS_CHANGE_REQUESTED', { settings: newSettings });

    // Update popover UI
    if (this.element) {
      const currentSettings = this.getCurrentSettingsFromUI();
      const updatedSettings = { ...currentSettings, ...newSettings };
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = createSettingsPopoverHTML(updatedSettings);
      const newContent = tempDiv.firstElementChild as HTMLElement;
      this.element.innerHTML = newContent.innerHTML;
    }
  };

  private getCurrentSettingsFromUI(): UISettings {
    // Extract current settings from the popover UI state
    const settings: UISettings = {
      sortBy: 'lastModified',
      density: 'comfortable',
      showSummary: true,
      showTags: true,
      showBadges: true
    };

    if (this.element) {
      const sortByActive = this.element.querySelector('[data-setting="sortBy"] .is-active');
      if (sortByActive) {
        settings.sortBy = (sortByActive as HTMLElement).dataset.value as 'lastModified' | 'title';
      }

      const densityActive = this.element.querySelector('[data-setting="density"] .is-active');
      if (densityActive) {
        settings.density = (densityActive as HTMLElement).dataset.value as 'comfortable' | 'compact';
      }

      const summaryCheckbox = this.element.querySelector<HTMLInputElement>('[data-key="summary"]');
      if (summaryCheckbox) settings.showSummary = summaryCheckbox.checked;

      const tagsCheckbox = this.element.querySelector<HTMLInputElement>('[data-key="tags"]');
      if (tagsCheckbox) settings.showTags = tagsCheckbox.checked;

      const badgesCheckbox = this.element.querySelector<HTMLInputElement>('[data-key="badges"]');
      if (badgesCheckbox) settings.showBadges = badgesCheckbox.checked;
    }

    return settings;
  }

  destroy(): void {
    this.hide();
  }
}
