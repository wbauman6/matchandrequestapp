import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<Tile />, document.body);
};

function Tile() {
  return (
    <s-tile
      heading="Match and Request"
      subheading="Customer special orders"
      onClick={() => shopify.action.presentModal()}
    />
  );
}
