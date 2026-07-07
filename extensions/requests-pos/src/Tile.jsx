import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<Tile />, document.body);
};

function Tile() {
  return (
    <s-tile
      heading="Requests"
      subheading="Customer special orders"
      onClick={() => shopify.action.presentModal()}
    />
  );
}
