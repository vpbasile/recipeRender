# README

## Installation
Create and activate a virtual environment, then install dependencies:
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm install

## Usage
To run the application, place your YAML file in the recipes directory and run:
./run

The script first asks whether you want a PDF, a static web page, or an EPUB, then prompts you to choose a recipe.
Outputs are written to output/<recipe>.pdf, output/<recipe>.html, or output/<recipe>.epub.

The first menu also includes a default bundle option. It skips the test recipe, generates individual PDFs for every other recipe, writes one HTML page per recipe plus output/index.html, and creates a single indexed EPUB at output/recipes.epub.

## Contributing
Contributions are welcome! Please fork the repository and submit a pull request with your changes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.



