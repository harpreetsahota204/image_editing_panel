import { registerComponent, PluginComponentType } from "@fiftyone/plugins";
import ImageEditPanel from "./ImageEditPanel";

/**
 * Register the React panel component.
 *
 * The ``name`` here must match the ``component`` kwarg passed to
 * ``types.View(component="ImageEditPanel", ...)`` in the Python
 * ``ImageEditPanel.render()`` method.
 */
// composite_view renders look up PluginComponentType.Component (type 3),
// not PluginComponentType.Panel (type 2).
registerComponent({
  name: "ImageEditPanel",
  component: ImageEditPanel,
  type: PluginComponentType.Component,
});
