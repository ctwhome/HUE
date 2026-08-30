export function parseCsvPreview(text: string, maxRows = 200, maxColumns = 50) {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let truncated = false;
	const addField = () => {
		if (row.length < maxColumns) row.push(field);
		else truncated = true;
		field = '';
	};
	const addRow = () => {
		addField();
		if (rows.length < maxRows) rows.push(row);
		else truncated = true;
		row = [];
	};

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (character === '"') {
			if (quoted && text[index + 1] === '"') {
				field += '"';
				index += 1;
			} else quoted = !quoted;
		} else if (character === ',' && !quoted) addField();
		else if ((character === '\n' || character === '\r') && !quoted) {
			if (character === '\r' && text[index + 1] === '\n') index += 1;
			addRow();
		} else field += character;
	}
	if (field || row.length || (text && !/[\r\n]$/.test(text))) addRow();
	return { rows, truncated };
}
