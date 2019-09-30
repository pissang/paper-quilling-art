module.exports = {
    entry: {
        main: __dirname + '/src/main.js',
        render: __dirname + '/src/offlineRender.js'
    },
    output: {
        path: __dirname + '/dist',
        filename: '[name]-bundle.js'
    },
    module: {
        rules: [
            {
                test: /\.glsl$/,
                exclude: /node_modules/,
                use: {
                    loader: 'text-loader'
                }
            }
        ]
    }
};